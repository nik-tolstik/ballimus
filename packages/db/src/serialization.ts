export type SerializedDatabaseValue =
  | null
  | boolean
  | number
  | string
  | SerializedDatabaseValue[]
  | { [key: string]: SerializedDatabaseValue | undefined };

export function serializeBigInt(value: bigint): string {
  return value.toString(10);
}

export function serializeTelegramId(value: bigint): string {
  return serializeBigInt(value);
}

export function parseBigInt(value: string | bigint, fieldName = "bigint"): bigint {
  if (typeof value === "bigint") return value;
  if (!/^-?\d+$/.test(value)) {
    throw new TypeError(`${fieldName} must be a base-10 integer string`);
  }
  return BigInt(value);
}

export function normalizeTelegramUsername(username: string): string {
  return username.trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
}

export function serializeDatabaseValue(value: unknown): SerializedDatabaseValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "bigint") return serializeBigInt(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDatabaseValue(item) ?? null);
  }
  if (typeof value === "object") {
    const result: { [key: string]: SerializedDatabaseValue | undefined } = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = serializeDatabaseValue(item);
    }
    return result;
  }
  throw new TypeError(`Unsupported database value type: ${typeof value}`);
}

export function serializeDatabaseRow(row: Record<string, unknown>): Record<string, SerializedDatabaseValue | undefined> {
  const serialized = serializeDatabaseValue(row);
  if (!serialized || Array.isArray(serialized) || typeof serialized !== "object") {
    throw new TypeError("Database rows must be plain objects");
  }
  return serialized;
}
