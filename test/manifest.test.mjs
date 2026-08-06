import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateCompanionPackage,
  validateManifest,
  validatePackage,
} from "../tools/validate-workspace.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIRECTORY, "..");

async function readProjectJson(relativePath) {
  const source = await readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
  return JSON.parse(source);
}

test("module manifest matches the supported Foundry and dnd5e contract", async () => {
  const manifest = await readProjectJson("module.json");

  assert.deepEqual(validateManifest(manifest), []);
});

test("root package is dependency-free and exposes operational commands", async () => {
  const packageJson = await readProjectJson("package.json");
  const manifest = await readProjectJson("module.json");

  assert.deepEqual(validatePackage(packageJson), []);
  assert.equal(packageJson.version, manifest.version);
});

test("companion package exposes its dependency-free Node entrypoint", async () => {
  const packageJson = await readProjectJson("companion/package.json");
  const manifest = await readProjectJson("module.json");

  assert.deepEqual(validateCompanionPackage(packageJson), []);
  assert.equal(packageJson.version, manifest.version);
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.devDependencies ?? {}, {});
});

test("manifest validation reports incompatible dnd5e bounds", async () => {
  const manifest = await readProjectJson("module.json");
  const incompatible = structuredClone(manifest);
  incompatible.relationships.systems[0].compatibility.minimum = "6.0.0";

  assert.match(validateManifest(incompatible).join("\n"), /dnd5e compatibility\.minimum/);
});
