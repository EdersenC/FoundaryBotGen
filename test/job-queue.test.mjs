import assert from "node:assert/strict";
import test from "node:test";

import {ProviderError} from "../companion/src/errors.mjs";
import {GenerationJobQueue} from "../companion/src/job-queue.mjs";
import {createGenerationRequest, createGenerationResult} from "./fixtures/generation.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, reject, resolve};
}

async function waitForStatus(queue, jobId, expectedStatus) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = queue.get(jobId);
    if (snapshot.status === expectedStatus) return snapshot;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Job ${jobId} did not reach ${expectedStatus}`);
}

test("queue executes one validated job and returns defensive progress snapshots", async () => {
  const completion = deferred();
  let reportProgress;
  const generator = {
    health: async () => ({status: "ready", model: "qwen3:4b-instruct"}),
    generate: async (_request, {onProgress}) => {
      reportProgress = onProgress;
      return completion.promise;
    },
  };
  const queue = new GenerationJobQueue({generator, idFactory: () => "job-1"});

  assert.deepEqual(queue.submit(createGenerationRequest({count: 1})), {
    jobId: "job-1",
    status: "queued",
  });
  await waitForStatus(queue, "job-1", "running");

  reportProgress(1, 1);
  const progress = queue.get("job-1");
  assert.deepEqual(progress.progress, {completed: 1, total: 1});
  progress.progress.completed = 99;
  assert.deepEqual(queue.get("job-1").progress, {completed: 1, total: 1});

  completion.resolve(createGenerationResult());
  const succeeded = await waitForStatus(queue, "job-1", "succeeded");
  assert.deepEqual(succeeded.progress, {completed: 1, total: 1});
  assert.equal(succeeded.result.npcs[0].name, "Mara Venn");
});

test("queue publishes partial success instead of discarding validated NPCs", async () => {
  const generator = {
    health: async () => ({status: "ready"}),
    generate: async () => createGenerationResult(undefined, {
      requestedCount: 2,
      failures: [{
        slot: 2,
        code: "NPC_OUTPUT_INVALID",
        message: "NPC slot 2 failed validation.",
      }],
    }),
  };
  const queue = new GenerationJobQueue({generator, idFactory: () => "job-partial"});

  queue.submit(createGenerationRequest());
  const succeeded = await waitForStatus(queue, "job-partial", "succeeded");

  assert.equal(succeeded.result.npcs.length, 1);
  assert.equal(succeeded.result.failures.length, 1);
  assert.equal(succeeded.activity.code, "job.succeeded-partial");
  assert.equal(succeeded.activity.level, "warn");
});

test("cancelling an active job aborts generation and retains cancelled status", async () => {
  const generator = {
    health: async () => ({status: "ready"}),
    generate: async (_request, {signal}) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {once: true});
    }),
  };
  const queue = new GenerationJobQueue({generator, idFactory: () => "job-cancel"});
  queue.submit(createGenerationRequest());
  await waitForStatus(queue, "job-cancel", "running");

  const cancelled = queue.cancel("job-cancel");

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.get("job-cancel").status, "cancelled");
});

test("queue serializes provider failures without leaking their cause", async () => {
  const sensitiveCause = new Error("private upstream detail");
  const generator = {
    health: async () => ({status: "unavailable"}),
    generate: async () => {
      throw new ProviderError("OLLAMA_TIMEOUT", "Ollama timed out", {
        retryable: true,
        cause: sensitiveCause,
      });
    },
  };
  const queue = new GenerationJobQueue({generator, idFactory: () => "job-failed"});
  queue.submit(createGenerationRequest());

  const failed = await waitForStatus(queue, "job-failed", "failed");

  assert.deepEqual(failed.error, {
    code: "OLLAMA_TIMEOUT",
    message: "Ollama timed out",
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(failed), /private upstream detail/);
  assert.equal(failed.activity.code, "job.failed");
  assert.deepEqual(
    failed.events.map(({code}) => code),
    ["job.queued", "job.started", "job.failed"],
  );
});

test("queue rejects malformed requests before retaining a job", () => {
  const queue = new GenerationJobQueue({
    generator: {health: async () => ({status: "ready"}), generate: async () => ({})},
  });

  assert.throws(() => queue.submit({prompt: "incomplete"}), /Contract validation failed/);
  assert.equal(queue.jobs.size, 0);
});
