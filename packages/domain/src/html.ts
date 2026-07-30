/** Escapes the characters that Telegram HTML mode treats as markup. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Truncates plain text before escaping so an HTML fragment stays well-formed. */
export function truncatePlainText(value: string, maxLength: number): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 0) throw new Error("maxLength must be a non-negative safe integer");
  if (value.length <= maxLength) return value;
  if (maxLength === 0) return "";
  if (maxLength === 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
}

export function escapedTextWithinLimit(value: string, maxLength: number): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 0) throw new Error("maxLength must be a non-negative safe integer");
  let candidate = value;
  while (escapeHtml(candidate).length > maxLength && candidate.length > 0) {
    candidate = truncatePlainText(candidate.slice(0, -1), candidate.length - 1);
  }
  return escapeHtml(candidate);
}
