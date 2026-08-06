const LEVEL_METHODS = Object.freeze({
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
});

/**
 * Create a small structured console logger for companion lifecycle events.
 * Event fields must be operational metadata; prompts and credentials never belong here.
 */
export function createCompanionLogger({sink = console, clock = () => new Date()} = {}) {
  return Object.freeze({
    event(level, code, fields = {}) {
      const normalizedLevel = Object.hasOwn(LEVEL_METHODS, level) ? level : "info";
      const method = LEVEL_METHODS[normalizedLevel];
      const timestamp = clock().toISOString();
      const metadata = formatFields(fields);
      sink[method]?.(
        `${timestamp} ${normalizedLevel.toUpperCase()} ${code}${metadata ? ` ${metadata}` : ""}`,
      );
    },
  });
}

function formatFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => `${name}=${formatValue(value)}`)
    .join(" ");
}

function formatValue(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value).slice(0, 500));
}
