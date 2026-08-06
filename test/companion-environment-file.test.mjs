import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCompanionEnvironment,
  parseCompanionEnvironment,
} from "../companion/src/environment-file.mjs";
import {readConfig} from "../companion/src/config.mjs";

const VALID_TOKEN = "0123456789abcdef0123456789abcdef";

test("checked-in environment example cannot start with a shared credential", async () => {
  const source = await readFile(
    new URL("../companion/.env.example", import.meta.url),
    "utf8",
  );
  const values = parseCompanionEnvironment(source);

  assert.equal(values.NPCBOT_PAIRING_TOKEN, "CHANGE_ME");
  assert.throws(() => readConfig(values), /at least 16 characters/);
});

test("companion environment parser accepts supported values and comments", () => {
  const values = parseCompanionEnvironment([
    "\uFEFF# Local NPCBOT settings",
    `NPCBOT_PAIRING_TOKEN='${VALID_TOKEN}'`,
    "NPCBOT_ALLOWED_ORIGINS=http://localhost:30000,https://foundry.example",
    "NPCBOT_PORT=43129",
    "",
  ].join("\r\n"));

  assert.deepEqual(values, {
    NPCBOT_PAIRING_TOKEN: VALID_TOKEN,
    NPCBOT_ALLOWED_ORIGINS: "http://localhost:30000,https://foundry.example",
    NPCBOT_PORT: "43129",
  });
  assert.equal(Object.isFrozen(values), true);
});

test("companion environment parser rejects malformed, unknown, and duplicate keys", () => {
  assert.throws(
    () => parseCompanionEnvironment("NPCBOT_PAIRING_TOKEN"),
    /line 1: expected NPCBOT_NAME=value/,
  );
  assert.throws(
    () => parseCompanionEnvironment("UNRELATED_SETTING=value"),
    /line 1: unsupported key UNRELATED_SETTING/,
  );
  assert.throws(
    () => parseCompanionEnvironment("NPCBOT_PORT=43129\nNPCBOT_PORT=43130"),
    /line 2: duplicate key NPCBOT_PORT/,
  );
  assert.throws(
    () => parseCompanionEnvironment("NPCBOT_OLLAMA_MODEL='qwen3:4b-instruct"),
    /line 1: unterminated quoted value/,
  );
});

test("companion environment file loads atomically without overriding the shell", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "npcbot-env-test-"));
  t.after(() => rm(directory, {recursive: true, force: true}));

  const filePath = path.join(directory, ".env");
  await writeFile(filePath, [
    `NPCBOT_PAIRING_TOKEN=${VALID_TOKEN}`,
    "NPCBOT_PORT=43130",
    "NPCBOT_OLLAMA_MODEL=qwen3:4b-instruct",
  ].join("\n"));

  const environment = {NPCBOT_PORT: "43131"};
  const result = await loadCompanionEnvironment({filePath, environment});
  const config = readConfig(environment);

  assert.deepEqual(result, {
    loaded: true,
    appliedKeys: ["NPCBOT_PAIRING_TOKEN", "NPCBOT_OLLAMA_MODEL"],
  });
  assert.equal(config.port, 43_131);
  assert.equal(config.pairingToken, VALID_TOKEN);
  assert.equal(config.ollamaModel, "qwen3:4b-instruct");
});

test("missing or invalid environment files leave the supplied environment unchanged", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "npcbot-env-test-"));
  t.after(() => rm(directory, {recursive: true, force: true}));

  const environment = {NPCBOT_PORT: "43129"};
  const missing = await loadCompanionEnvironment({
    filePath: path.join(directory, "missing.env"),
    environment,
  });

  assert.deepEqual(missing, {loaded: false, appliedKeys: []});
  assert.deepEqual(environment, {NPCBOT_PORT: "43129"});

  const invalidPath = path.join(directory, "invalid.env");
  await writeFile(invalidPath, [
    `NPCBOT_PAIRING_TOKEN=${VALID_TOKEN}`,
    "MISSPELLED_NPCBOT_PORT=43130",
  ].join("\n"));

  await assert.rejects(
    loadCompanionEnvironment({filePath: invalidPath, environment}),
    /line 2: unsupported key MISSPELLED_NPCBOT_PORT/,
  );
  assert.deepEqual(environment, {NPCBOT_PORT: "43129"});
});
