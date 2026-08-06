import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_ENVIRONMENT_FILE = fileURLToPath(
  new URL("../.env", import.meta.url),
);

const SUPPORTED_KEYS = Object.freeze([
  "NPCBOT_PAIRING_TOKEN",
  "NPCBOT_ALLOWED_ORIGINS",
  "NPCBOT_HOST",
  "NPCBOT_PORT",
  "NPCBOT_OLLAMA_URL",
  "NPCBOT_OLLAMA_MODEL",
  "NPCBOT_REQUEST_TIMEOUT_MS",
]);

const SUPPORTED_KEY_SET = new Set(SUPPORTED_KEYS);

/**
 * Load the optional companion .env file without overriding values explicitly
 * supplied by the process environment.
 *
 * @param {{filePath?: string, environment?: Record<string, string|undefined>}} [options]
 */
export async function loadCompanionEnvironment(options = {}) {
  const filePath = options.filePath ?? DEFAULT_ENVIRONMENT_FILE;
  const environment = options.environment ?? process.env;
  const source = await readOptionalFile(filePath);

  if (source === null) {
    return environmentLoadResult(false, []);
  }

  const fileValues = parseCompanionEnvironment(source);
  const appliedKeys = [];

  for (const [key, value] of Object.entries(fileValues)) {
    if (environment[key] !== undefined) continue;
    environment[key] = value;
    appliedKeys.push(key);
  }

  return environmentLoadResult(true, appliedKeys);
}

/**
 * Parse the intentionally small NPCBOT .env format.
 *
 * Blank lines and lines beginning with # are ignored. Values may be unquoted
 * or wrapped in matching single or double quotes. Inline comments and shell
 * expansion are intentionally unsupported.
 *
 * @param {string} source
 */
export function parseCompanionEnvironment(source) {
  if (typeof source !== "string") {
    throw new TypeError("Companion environment source must be a string");
  }

  const values = {};
  const seenKeys = new Set();
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex <= 0) {
      throw environmentFileError(lineNumber, "expected NPCBOT_NAME=value");
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    if (!SUPPORTED_KEY_SET.has(key)) {
      throw environmentFileError(lineNumber, `unsupported key ${key}`);
    }
    if (seenKeys.has(key)) {
      throw environmentFileError(lineNumber, `duplicate key ${key}`);
    }

    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    values[key] = unwrapValue(rawValue, lineNumber);
    seenKeys.add(key);
  }

  return Object.freeze(values);
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function unwrapValue(value, lineNumber) {
  if (!value.startsWith("\"") && !value.startsWith("'")) return value;

  const quote = value[0];
  if (value.length < 2 || value.at(-1) !== quote) {
    throw environmentFileError(lineNumber, "unterminated quoted value");
  }

  return value.slice(1, -1);
}

function environmentFileError(lineNumber, detail) {
  return new Error(`Invalid companion .env line ${lineNumber}: ${detail}`);
}

function environmentLoadResult(loaded, appliedKeys) {
  return Object.freeze({
    loaded,
    appliedKeys: Object.freeze([...appliedKeys]),
  });
}

export const COMPANION_ENVIRONMENT_KEYS = SUPPORTED_KEYS;
