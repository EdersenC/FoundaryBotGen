import { randomUUID } from "node:crypto";
import { validateGenerationRequest } from "../../shared/contracts/npc-generation.mjs";
import { HttpError, ProviderError } from "./errors.mjs";

const MAX_RETAINED_JOBS = 100;
const MAX_PENDING_JOBS = 24;
const MAX_JOB_EVENTS = 50;
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export class GenerationJobQueue {
  constructor({ generator, idFactory = randomUUID, logger = null, clock = () => new Date() }) {
    this.generator = generator;
    this.idFactory = idFactory;
    this.jobs = new Map();
    this.pendingJobIds = [];
    this.activeJobId = null;
    this.draining = false;
    this.logger = logger;
    this.clock = clock;
  }

  submit(value) {
    const request = validateGenerationRequest(value);
    const pendingCount = this.pendingJobIds.length + (this.activeJobId ? 1 : 0);
    if (pendingCount >= MAX_PENDING_JOBS) {
      throw new HttpError(
        503,
        "QUEUE_FULL",
        "The local generation queue is full; try again later",
      );
    }
    this.pruneTerminalJobs();

    const jobId = this.idFactory();
    const job = {
      jobId,
      status: "queued",
      progress: { completed: 0, total: request.count },
      request,
      controller: null,
      result: undefined,
      error: undefined,
      createdAt: this.timestamp(),
      updatedAt: null,
      activity: null,
      events: [],
    };
    job.updatedAt = job.createdAt;
    this.jobs.set(jobId, job);
    this.recordEvent(job, {
      level: "info",
      code: "job.queued",
      message: `Queued generation for ${request.count} NPC${request.count === 1 ? "" : "s"}.`,
    });
    this.pendingJobIds.push(jobId);
    void this.drain();
    return { jobId, status: "queued" };
  }

  get(jobId) {
    return snapshot(this.requireJob(jobId));
  }

  cancel(jobId) {
    const job = this.requireJob(jobId);
    if (job.status === "cancelled") return snapshot(job);
    if (TERMINAL_STATUSES.has(job.status)) {
      throw new HttpError(
        409,
        "JOB_ALREADY_FINISHED",
        `A ${job.status} job cannot be cancelled`,
      );
    }

    if (job.status === "queued") {
      this.pendingJobIds = this.pendingJobIds.filter(
        (pendingJobId) => pendingJobId !== jobId,
      );
    }
    job.status = "cancelled";
    job.error = undefined;
    job.controller?.abort(new DOMException("Job cancelled", "AbortError"));
    this.recordEvent(job, {
      level: "warn",
      code: "job.cancelled",
      message: "Generation cancelled by the GM.",
    });
    return snapshot(job);
  }

  async health() {
    const provider = await this.generator.health();
    return {
      status: provider.status === "ready" ? "ok" : "degraded",
      queue: {
        active: this.activeJobId === null ? 0 : 1,
        pending: this.pendingJobIds.filter((jobId) => {
          const job = this.jobs.get(jobId);
          return job?.status === "queued";
        }).length,
      },
      provider,
    };
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pendingJobIds.length > 0) {
        const jobId = this.pendingJobIds.shift();
        const job = this.jobs.get(jobId);
        if (!job || job.status !== "queued") continue;
        await this.run(job);
      }
    } finally {
      this.activeJobId = null;
      this.draining = false;
      if (this.pendingJobIds.length > 0) void this.drain();
    }
  }

  async run(job) {
    this.activeJobId = job.jobId;
    job.status = "running";
    job.controller = new AbortController();
    this.recordEvent(job, {
      level: "info",
      code: "job.started",
      message: "Generation started.",
    });
    try {
      const result = await this.generator.generate(job.request, {
        signal: job.controller.signal,
        onProgress: (completed, total) => {
          if (job.status !== "running") return;
          job.progress = { completed, total };
        },
        onEvent: (event) => this.recordEvent(job, event),
      });
      if (job.status !== "running") return;
      job.result = result;
      job.progress = { completed: job.progress.total, total: job.progress.total };
      job.status = "succeeded";
      const failureCount = result.failures?.length ?? 0;
      this.recordEvent(job, failureCount > 0
        ? {
            level: "warn",
            code: "job.succeeded-partial",
            message: `Generation completed with ${result.npcs.length} validated NPC${result.npcs.length === 1 ? "" : "s"} and ${failureCount} failed slot${failureCount === 1 ? "" : "s"}.`,
          }
        : {
            level: "info",
            code: "job.succeeded",
            message: `Generation completed with ${result.npcs.length} validated NPC${result.npcs.length === 1 ? "" : "s"}.`,
          });
    } catch (error) {
      if (job.status === "cancelled") return;
      job.status = "failed";
      job.error = serializeJobError(error);
      this.recordEvent(job, {
        level: "error",
        code: "job.failed",
        message: `${job.error.code}: ${job.error.message}`,
      });
    } finally {
      job.controller = null;
      this.activeJobId = null;
    }
  }

  recordEvent(job, event) {
    if (!job || !event || typeof event.message !== "string") return;
    const timestamp = this.timestamp();
    const record = {
      timestamp,
      level: normalizeEventLevel(event.level),
      code: normalizeEventCode(event.code),
      message: event.message.slice(0, 500),
    };
    job.updatedAt = timestamp;
    job.activity = { ...record };
    job.events.push(record);
    if (job.events.length > MAX_JOB_EVENTS) job.events.splice(0, job.events.length - MAX_JOB_EVENTS);
    this.logger?.event?.(record.level, record.code, {
      jobId: job.jobId,
      requestId: job.request.requestId,
      message: record.message,
    });
  }

  timestamp() {
    return this.clock().toISOString();
  }

  requireJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new HttpError(404, "JOB_NOT_FOUND", "Generation job not found");
    }
    return job;
  }

  pruneTerminalJobs() {
    if (this.jobs.size < MAX_RETAINED_JOBS) return;
    for (const [jobId, job] of this.jobs) {
      if (this.jobs.size < MAX_RETAINED_JOBS) break;
      if (TERMINAL_STATUSES.has(job.status)) this.jobs.delete(jobId);
    }
    if (this.jobs.size >= MAX_RETAINED_JOBS) {
      throw new HttpError(
        503,
        "JOB_CAPACITY_REACHED",
        "Too many generation jobs are retained; try again after current work finishes",
      );
    }
  }
}

function snapshot(job) {
  return structuredClone({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    activity: job.activity,
    events: job.events,
    ...(job.result === undefined ? {} : { result: job.result }),
    ...(job.error === undefined ? {} : { error: job.error }),
  });
}

function normalizeEventLevel(level) {
  return new Set(["info", "warn", "error"]).has(level) ? level : "info";
}

function normalizeEventCode(code) {
  const value = typeof code === "string" ? code : "job.activity";
  return /^[a-z0-9.-]{1,80}$/.test(value) ? value : "job.activity";
}

function serializeJobError(error) {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "GENERATION_ABORTED",
      message: "NPC generation was interrupted",
      retryable: true,
    };
  }
  return {
    code: "GENERATION_FAILED",
    message: "NPC generation failed unexpectedly",
    retryable: false,
  };
}
