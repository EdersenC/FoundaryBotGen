import assert from "node:assert/strict";
import test from "node:test";

import {
  CompanionClient,
  CompanionRequestError,
  normalizeEndpoint,
} from "../scripts/companion-client.mjs";

function jsonResponse(payload, {status = 200} = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"Content-Type": "application/json"},
  });
}

function createClient(responses) {
  const calls = [];
  const queue = [...responses];
  const client = new CompanionClient({
    endpoint: "http://127.0.0.1:43129",
    pairingToken: "test-pairing-token",
    fetchWithTimeout: async (...args) => {
      calls.push(args);
      const response = queue.shift();
      assert.ok(response, "fake fetch received an unexpected call");
      return response;
    },
  });
  return {calls, client};
}

test("queueGeneration posts JSON to the authenticated jobs route", async () => {
  const {calls, client} = createClient([
    jsonResponse({jobId: "job-1", status: "queued"}, {status: 202}),
  ]);
  const request = {schemaVersion: "2", requestId: "request-1"};

  const snapshot = await client.queueGeneration(request);

  assert.deepEqual(snapshot, {jobId: "job-1", status: "queued"});
  assert.equal(calls.length, 1);
  const [url, init, options] = calls[0];
  assert.equal(url, "http://127.0.0.1:43129/v1/npc-generation-jobs");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.get("Authorization"), "Bearer test-pairing-token");
  assert.equal(init.headers.get("Content-Type"), "application/json");
  assert.equal(init.body, JSON.stringify(request));
  assert.equal(options.timeoutMs, 30_000);
});

test("health checks use the authenticated companion endpoint", async () => {
  const {calls, client} = createClient([
    jsonResponse({
      status: "ok",
      queue: {active: 0, pending: 0},
      provider: {status: "ready", model: "qwen3:4b-instruct"},
    }),
  ]);

  const health = await client.health();

  assert.equal(health.provider.status, "ready");
  assert.equal(calls[0][0], "http://127.0.0.1:43129/v1/health");
  assert.equal(calls[0][1].headers.get("Authorization"), "Bearer test-pairing-token");
  assert.equal(calls[0][2].timeoutMs, 7_500);
});

test("get and cancel encode job IDs and enforce companion statuses", async () => {
  const {calls, client} = createClient([
    jsonResponse({jobId: "job/with spaces", status: "running"}),
    jsonResponse({jobId: "job/with spaces", status: "cancelled"}),
  ]);

  await client.getGeneration("job/with spaces");
  await client.cancelGeneration("job/with spaces");

  assert.equal(calls[0][0], "http://127.0.0.1:43129/v1/npc-generation-jobs/job%2Fwith%20spaces");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][2].timeoutMs, 15_000);
  assert.equal(calls[1][1].method, "DELETE");
});

test("queueGeneration rejects an unexpected terminal status", async () => {
  const {client} = createClient([
    jsonResponse({jobId: "job-1", status: "succeeded"}),
  ]);

  await assert.rejects(
    client.queueGeneration({}),
    (error) => error instanceof CompanionRequestError && /unexpected job status/.test(error.message),
  );
});

test("HTTP errors preserve the companion message and status", async () => {
  const {client} = createClient([
    jsonResponse({error: {message: "Model is unavailable."}}, {status: 503}),
  ]);

  await assert.rejects(
    client.getGeneration("job-1"),
    (error) => error instanceof CompanionRequestError
      && error.status === 503
      && error.message === "Model is unavailable.",
  );
});

test("endpoint and token validation reject unsafe client configuration", () => {
  assert.throws(
    () => normalizeEndpoint("file:///tmp/companion.sock"),
    /must use HTTP or HTTPS/,
  );
  assert.throws(
    () => normalizeEndpoint("http://user:password@localhost:43129/?token=secret"),
    /cannot include credentials/,
  );
  assert.throws(
    () => new CompanionClient({
      endpoint: "http://localhost:43129",
      pairingToken: " ",
      fetchWithTimeout: async () => jsonResponse({}),
    }),
    /pairing token is required/,
  );
});

test("endpoint path prefixes are preserved for reverse-proxy deployments", async () => {
  const calls = [];
  const client = new CompanionClient({
    endpoint: "https://foundry.example/local-npcbot",
    pairingToken: "test-pairing-token",
    fetchWithTimeout: async (...args) => {
      calls.push(args);
      return jsonResponse({jobId: "job-1", status: "queued"}, {status: 202});
    },
  });

  await client.queueGeneration({schemaVersion: "2"});

  assert.equal(
    calls[0][0],
    "https://foundry.example/local-npcbot/v1/npc-generation-jobs",
  );
});
