#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {mkdtemp, mkdir, cp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const TOOL_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(TOOL_PATH), "..");
const MODULE_PATHS = Object.freeze([
  "module.json",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "lang",
  "scripts",
  "shared",
  "styles",
  "templates",
]);

await packageModule();

async function packageModule() {
  const manifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, "module.json"), "utf8"));
  assertReleaseVersion(manifest.version);

  const outputDirectory = path.join(PROJECT_ROOT, "dist");
  const artifactName = `${manifest.id}-v${manifest.version}.zip`;
  const artifactPath = path.join(outputDirectory, artifactName);
  const stagingDirectory = await mkdtemp(path.join(tmpdir(), `${manifest.id}-package-`));

  try {
    await mkdir(outputDirectory, {recursive: true});
    await rm(artifactPath, {force: true});
    await copyModuleRuntime(stagingDirectory);
    createZip(stagingDirectory, artifactPath);
    verifyZip(artifactPath);
    console.log(`Created ${path.relative(PROJECT_ROOT, artifactPath)}`);
  } finally {
    await rm(stagingDirectory, {recursive: true, force: true});
  }
}

async function copyModuleRuntime(stagingDirectory) {
  for (const relativePath of MODULE_PATHS) {
    await cp(
      path.join(PROJECT_ROOT, relativePath),
      path.join(stagingDirectory, relativePath),
      {recursive: true},
    );
  }
}

function createZip(stagingDirectory, artifactPath) {
  const result = spawnSync("zip", ["-q", "-r", artifactPath, ...MODULE_PATHS], {
    cwd: stagingDirectory,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`zip failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
}

function verifyZip(artifactPath) {
  const result = spawnSync("unzip", ["-Z1", artifactPath], {encoding: "utf8"});
  if (result.status !== 0) {
    throw new Error(`unzip verification failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  const entries = result.stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.includes("module.json")) {
    throw new Error("Packaged archive must contain module.json at its root");
  }
  const unsafeEntry = entries.find((entry) => path.isAbsolute(entry) || entry.split("/").includes(".."));
  if (unsafeEntry) throw new Error(`Packaged archive contains an unsafe path: ${unsafeEntry}`);

  const developmentEntry = entries.find((entry) =>
    /^(?:companion|test|tools|\.git|\.github|dist)(?:\/|$)/.test(entry),
  );
  if (developmentEntry) {
    throw new Error(`Packaged archive contains a development-only path: ${developmentEntry}`);
  }
}

function assertReleaseVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`module.json version is not release-safe: ${version}`);
  }
}
