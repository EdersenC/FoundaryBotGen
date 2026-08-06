import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createCompanionRequestHandler } from "../src/server.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef";
const ORIGIN = "http://localhost:30000";

test("HTTP boundary enforces auth and exact-origin CORS across job routes", async () => {
  const jobQueue = {
    health: async () => ({
      status: "ok",
      queue: { active: 0, pending: 0 },
      provider: { status: "ready", model: "qwen3:4b-instruct" },
    }),
    submit: () => ({ jobId: "job-1", status: "queued" }),
    get: (jobId) => ({
      jobId,
      status: "running",
      progress: { completed: 0, total: 1 },
    }),
    cancel: (jobId) => ({
      jobId,
      status: "cancelled",
      progress: { completed: 0, total: 1 },
    }),
  };
  const handle = createCompanionRequestHandler({
    config: {
      allowedOrigins: [ORIGIN],
      pairingToken: TOKEN,
    },
    jobQueue,
    logger: { error: () => {} },
  });
  const unauthorized = await send(handle, { method: "GET", url: "/v1/health" });
  assert.equal(unauthorized.status, 401);

  const forbiddenOrigin = await send(handle, {
    method: "GET",
    url: "/v1/health",
    headers: authenticatedHeaders("http://evil.example"),
  });
  assert.equal(forbiddenOrigin.status, 403);
  assert.equal(forbiddenOrigin.headers.get("vary"), "Origin");

  const preflight = await send(handle, {
    method: "OPTIONS",
    url: "/v1/npc-generation-jobs",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

  const queued = await send(handle, {
    method: "POST",
    url: "/v1/npc-generation-jobs",
    headers: {
      ...authenticatedHeaders(ORIGIN),
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(queued.status, 202);
  assert.deepEqual(queued.json(), { jobId: "job-1", status: "queued" });
  assert.equal(queued.headers.get("access-control-allow-origin"), ORIGIN);

  const running = await send(handle, {
    method: "GET",
    url: "/v1/npc-generation-jobs/job-1",
    headers: authenticatedHeaders(ORIGIN),
  });
  assert.deepEqual(running.json(), {
    jobId: "job-1",
    status: "running",
    progress: { completed: 0, total: 1 },
  });

  const cancelled = await send(handle, {
    method: "DELETE",
    url: "/v1/npc-generation-jobs/job-1",
    headers: authenticatedHeaders(ORIGIN),
  });
  assert.deepEqual(cancelled.json(), {
    jobId: "job-1",
    status: "cancelled",
    progress: { completed: 0, total: 1 },
  });

  const oversized = await send(handle, {
    method: "POST",
    url: "/v1/npc-generation-jobs",
    headers: {
      ...authenticatedHeaders(ORIGIN),
      "Content-Type": "application/json",
    },
    body: "x".repeat(262_145),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json().error.code, "REQUEST_TOO_LARGE");

  const invalidMediaType = await send(handle, {
    method: "POST",
    url: "/v1/npc-generation-jobs",
    headers: {
      ...authenticatedHeaders(ORIGIN),
      "Content-Type": "application/json-malicious",
    },
    body: "{}",
  });
  assert.equal(invalidMediaType.status, 415);
});

function authenticatedHeaders(origin) {
  return {
    authorization: `Bearer ${TOKEN}`,
    origin,
  };
}

async function send(handle, { method, url, headers = {}, body }) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  request.method = method;
  request.url = url;
  request.headers = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const response = new MemoryResponse();
  await handle(request, response);
  return response;
}

class MemoryResponse {
  constructor() {
    this.headers = new Map();
    this.headersSent = false;
    this.statusCode = 200;
    this.body = "";
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), String(value));
  }

  end(body = "") {
    this.body = String(body);
    this.headersSent = true;
  }

  destroy() {
    this.headersSent = true;
  }

  get status() {
    return this.statusCode;
  }

  getHeader(name) {
    return this.headers.get(name.toLowerCase()) ?? null;
  }

  json() {
    return JSON.parse(this.body);
  }
}
