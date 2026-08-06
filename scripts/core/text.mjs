const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizePlainText(value, {maxLength = 10_000} = {}) {
  if (typeof value !== "string") return "";
  return value
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export function normalizeSingleLine(value, {maxLength = 200} = {}) {
  return normalizePlainText(value, {maxLength})
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function plainTextToParagraphs(value) {
  const text = normalizePlainText(value);
  if (!text) return "";

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

export function humanizeIdentifier(value) {
  return normalizeSingleLine(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
