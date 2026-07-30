export type RestJsonValue =
  | null
  | boolean
  | number
  | string
  | RestJsonValue[]
  | { readonly [key: string]: RestJsonValue };

/** Recursively converts database values to JSON-safe values at the REST boundary. */
export function serializeRestValue(value: unknown): RestJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeRestValue(item) ?? null);
  }
  if (typeof value === "object") {
    const result: Record<string, RestJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const serialized = serializeRestValue(item);
      if (serialized !== undefined) result[key] = serialized;
    }
    return result;
  }
  throw new TypeError(`Unsupported REST value type: ${typeof value}`);
}

export function serializeRestObject(value: Record<string, unknown>): Record<string, RestJsonValue> {
  const serialized = serializeRestValue(value);
  if (serialized === undefined || serialized === null || Array.isArray(serialized)) {
    throw new TypeError("REST response must be an object");
  }
  return serialized as Record<string, RestJsonValue>;
}
