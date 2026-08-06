#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(TOOL_PATH), "..");
const REPOSITORY_URL = "https://github.com/EdersenC/FoundaryBotGen";

const EXPECTED_PATHS = Object.freeze([
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "companion/.env.example",
  "companion/package.json",
  "companion/src/environment-file.mjs",
  "companion/src/main.mjs",
  "module.json",
  "package.json",
  "shared/contracts/npc-generation.mjs",
  "templates/npc-generator.hbs",
  "templates/npcbot-settings.hbs",
]);

const MODULE_DIRECTORIES = Object.freeze([
  "scripts",
  "shared",
  "companion",
  "tools",
  "test",
]);

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

function pushMismatch(issues, label, actual, expected) {
  if (actual !== expected) {
    issues.push(`${label} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`);
  }
}

export function validateManifest(manifest) {
  const issues = [];

  pushMismatch(issues, "module.json id", manifest.id, "foundry-npcbot");
  pushMismatch(issues, "module.json compatibility.minimum", manifest.compatibility?.minimum, "14.356");
  pushMismatch(issues, "module.json compatibility.verified", manifest.compatibility?.verified, "14.365");
  pushMismatch(issues, "module.json url", manifest.url, REPOSITORY_URL);
  pushMismatch(
    issues,
    "module.json manifest",
    manifest.manifest,
    `${REPOSITORY_URL}/releases/latest/download/module.json`,
  );
  pushMismatch(
    issues,
    "module.json download",
    manifest.download,
    `${REPOSITORY_URL}/releases/download/v${manifest.version}/foundry-npcbot-v${manifest.version}.zip`,
  );

  if (!manifest.esmodules?.includes("scripts/main.mjs")) {
    issues.push("module.json esmodules must include scripts/main.mjs.");
  }
  if (!manifest.styles?.includes("styles/styles.css")) {
    issues.push("module.json styles must include styles/styles.css.");
  }
  if (!manifest.languages?.some((language) => language.lang === "en" && language.path === "lang/en.json")) {
    issues.push("module.json languages must declare lang/en.json for English.");
  }
  if (!manifest.system?.includes("dnd5e")) {
    issues.push("module.json system must include dnd5e.");
  }

  const dnd5e = manifest.relationships?.systems?.find((system) => system.id === "dnd5e");
  if (!dnd5e) {
    issues.push("module.json relationships.systems must declare dnd5e.");
    return issues;
  }

  pushMismatch(issues, "dnd5e relationship type", dnd5e.type, "system");
  pushMismatch(issues, "dnd5e compatibility.minimum", dnd5e.compatibility?.minimum, "5.3.0");
  pushMismatch(issues, "dnd5e compatibility.verified", dnd5e.compatibility?.verified, "5.3.3");

  return issues;
}

export function validatePackage(packageJson) {
  const issues = [];

  pushMismatch(issues, "package.json type", packageJson.type, "module");

  for (const scriptName of ["companion", "test", "validate", "check", "package"]) {
    if (typeof packageJson.scripts?.[scriptName] !== "string") {
      issues.push(`package.json scripts.${scriptName} must be defined.`);
    }
  }

  for (const dependencyGroup of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = packageJson[dependencyGroup] ?? {};
    if (Object.keys(dependencies).length > 0) {
      issues.push(`Root package.json ${dependencyGroup} must remain empty.`);
    }
  }

  return issues;
}

export function validateCompanionPackage(packageJson) {
  const issues = [];

  pushMismatch(issues, "companion/package.json type", packageJson.type, "module");
  if (typeof packageJson.scripts?.start !== "string") {
    issues.push("companion/package.json scripts.start must be defined.");
  }

  return issues;
}

function manifestAssetPaths(manifest) {
  return [
    ...(manifest.esmodules ?? []),
    ...(manifest.styles ?? []),
    ...(manifest.languages ?? []).map((language) => language.path),
  ].filter((assetPath) => typeof assetPath === "string" && assetPath.length > 0);
}

async function collectMjsFiles(directory) {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMjsFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(entryPath);
    }
  }

  return files;
}

function syntaxIssue(root, filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status === 0) {
    return null;
  }

  const diagnostic = (result.stderr || result.stdout || "Unknown syntax error").trim();
  return `${path.relative(root, filePath)} failed node --check:\n${diagnostic}`;
}

export async function validateWorkspace(root = DEFAULT_ROOT) {
  const issues = [];
  const checkedFiles = [];

  for (const relativePath of EXPECTED_PATHS) {
    if (!(await pathExists(path.join(root, relativePath)))) {
      issues.push(`Missing expected path: ${relativePath}`);
    }
  }

  let manifest;
  try {
    manifest = await readJson(root, "module.json");
    issues.push(...validateManifest(manifest));
  } catch (error) {
    issues.push(`Unable to parse module.json: ${error.message}`);
  }

  if (manifest) {
    for (const assetPath of manifestAssetPaths(manifest)) {
      if (!(await pathExists(path.join(root, assetPath)))) {
        issues.push(`Manifest asset does not exist: ${assetPath}`);
      }
    }
    for (const language of manifest.languages ?? []) {
      if (typeof language.path !== "string") continue;
      try {
        await readJson(root, language.path);
      } catch (error) {
        issues.push(`Unable to parse language file ${language.path}: ${error.message}`);
      }
    }
  }

  try {
    const packageJson = await readJson(root, "package.json");
    issues.push(...validatePackage(packageJson));
    if (manifest) {
      pushMismatch(issues, "package.json version", packageJson.version, manifest.version);
    }
  } catch (error) {
    issues.push(`Unable to parse package.json: ${error.message}`);
  }

  try {
    const companionPackage = await readJson(root, "companion/package.json");
    issues.push(...validateCompanionPackage(companionPackage));
    if (manifest) {
      pushMismatch(issues, "companion/package.json version", companionPackage.version, manifest.version);
    }
  } catch (error) {
    issues.push(`Unable to parse companion/package.json: ${error.message}`);
  }

  for (const directory of MODULE_DIRECTORIES) {
    const files = await collectMjsFiles(path.join(root, directory));
    for (const filePath of files) {
      checkedFiles.push(path.relative(root, filePath));
      const issue = syntaxIssue(root, filePath);
      if (issue) {
        issues.push(issue);
      }
    }
  }

  return { issues, checkedFiles };
}

async function run() {
  const result = await validateWorkspace();

  if (result.issues.length > 0) {
    console.error(`Workspace validation failed with ${result.issues.length} issue(s):`);
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Workspace validation passed; syntax-checked ${result.checkedFiles.length} .mjs file(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === TOOL_PATH) {
  await run();
}
