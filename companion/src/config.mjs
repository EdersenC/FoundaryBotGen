const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "http://127.0.0.1:30000",
  "http://localhost:30000",
]);

const DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 43_129,
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen3:4b-instruct",
  requestTimeoutMs: 120_000,
});

/**
 * Read and validate companion configuration from environment variables.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [environment]
 */
export function readConfig(environment = process.env) {
  const pairingToken = requiredSecret(
    environment.NPCBOT_PAIRING_TOKEN,
    "NPCBOT_PAIRING_TOKEN",
  );
  const allowedOrigins = parseAllowedOrigins(
    environment.NPCBOT_ALLOWED_ORIGINS,
  );

  return Object.freeze({
    host: optionalText(environment.NPCBOT_HOST, DEFAULTS.host),
    port: parseInteger(environment.NPCBOT_PORT, DEFAULTS.port, 1, 65_535),
    allowedOrigins,
    pairingToken,
    ollamaUrl: parseBaseUrl(
      environment.NPCBOT_OLLAMA_URL,
      DEFAULTS.ollamaUrl,
    ),
    ollamaModel: optionalText(
      environment.NPCBOT_OLLAMA_MODEL,
      DEFAULTS.ollamaModel,
    ),
    requestTimeoutMs: parseInteger(
      environment.NPCBOT_REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
      1_000,
      15 * 60_000,
    ),
  });
}

function requiredSecret(value, name) {
  if (typeof value !== "string" || value.length < 16) {
    throw new Error(`${name} must contain at least 16 characters`);
  }
  if (value.trim() !== value) {
    throw new Error(`${name} must not begin or end with whitespace`);
  }
  return value;
}

function optionalText(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!normalized) throw new Error("Configuration values must not be empty");
  return normalized;
}

function parseInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected an integer configuration value, received ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Configuration integer must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseAllowedOrigins(value) {
  const candidates = value === undefined ? DEFAULT_ALLOWED_ORIGINS : value.split(",");
  const origins = candidates.map((candidate) => parseExactOrigin(candidate.trim()));
  if (origins.length === 0) {
    throw new Error("NPCBOT_ALLOWED_ORIGINS must contain at least one origin");
  }
  return Object.freeze([...new Set(origins)]);
}

function parseExactOrigin(value) {
  if (!value) throw new Error("Allowed origins must not be empty");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid allowed origin: ${value}`);
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== value) {
    throw new Error(`Allowed origin must be an exact HTTP(S) origin: ${value}`);
  }
  return parsed.origin;
}

function parseBaseUrl(value, fallback) {
  const candidate = optionalText(value, fallback);
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid NPCBOT_OLLAMA_URL: ${candidate}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("NPCBOT_OLLAMA_URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("NPCBOT_OLLAMA_URL must not contain credentials, query, or fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export const CONFIG_DEFAULTS = DEFAULTS;
