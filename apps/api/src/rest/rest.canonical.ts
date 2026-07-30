import { hashIdempotencyRequest } from "@football/db";

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** Hashes a stable method/path/body representation for HTTP idempotency. */
export function canonicalRequestHash(value: unknown): string {
  return hashIdempotencyRequest(canonicalize(value));
}
