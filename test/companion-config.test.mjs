import assert from "node:assert/strict";
import test from "node:test";

import {readConfig} from "../companion/src/config.mjs";

const VALID_TOKEN = "0123456789abcdef0123456789abcdef";

test("companion configuration keeps safe loopback defaults", () => {
  const config = readConfig({NPCBOT_PAIRING_TOKEN: VALID_TOKEN});

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 43_129);
  assert.deepEqual(config.allowedOrigins, [
    "http://127.0.0.1:30000",
    "http://localhost:30000",
  ]);
  assert.equal(config.ollamaUrl, "http://127.0.0.1:11434");
  assert.equal(config.ollamaModel, "qwen3:4b-instruct");
  assert.equal(config.requestTimeoutMs, 120_000);
  assert.equal(Object.isFrozen(config), true);
});

test("companion configuration accepts comma-separated exact origins", () => {
  const config = readConfig({
    NPCBOT_PAIRING_TOKEN: VALID_TOKEN,
    NPCBOT_ALLOWED_ORIGINS: "https://foundry.example,http://localhost:30000,https://foundry.example",
  });

  assert.deepEqual(config.allowedOrigins, [
    "https://foundry.example",
    "http://localhost:30000",
  ]);
});

test("companion configuration rejects weak tokens and non-exact origins", () => {
  assert.throws(
    () => readConfig({NPCBOT_PAIRING_TOKEN: "too-short"}),
    /at least 16 characters/,
  );
  assert.throws(
    () => readConfig({
      NPCBOT_PAIRING_TOKEN: VALID_TOKEN,
      NPCBOT_ALLOWED_ORIGINS: "*",
    }),
    /Invalid allowed origin/,
  );
  assert.throws(
    () => readConfig({
      NPCBOT_PAIRING_TOKEN: VALID_TOKEN,
      NPCBOT_ALLOWED_ORIGINS: "http://localhost:30000/",
    }),
    /must be an exact HTTP\(S\) origin/,
  );
});

test("companion configuration validates ports, timeouts, and Ollama URLs", () => {
  assert.throws(
    () => readConfig({
      NPCBOT_PAIRING_TOKEN: VALID_TOKEN,
      NPCBOT_PORT: "70000",
    }),
    /between 1 and 65535/,
  );
  assert.throws(
    () => readConfig({
      NPCBOT_PAIRING_TOKEN: VALID_TOKEN,
      NPCBOT_REQUEST_TIMEOUT_MS: "999",
    }),
    /between 1000 and 900000/,
  );
  assert.throws(
    () => readConfig({
      NPCBOT_PAIRING_TOKEN: VALID_TOKEN,
      NPCBOT_OLLAMA_URL: "http://user:password@localhost:11434",
    }),
    /must not contain credentials/,
  );
});
