import type { AppDatabase } from "../client.js";
import { parseBigInt } from "../serialization.js";
import { ValidationRepositoryError, mapDatabaseError } from "./errors.js";

export type DatabaseTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
export type DatabaseExecutor = AppDatabase | DatabaseTransaction;
export type DatabaseIdentifier = bigint | number | string;

export function toBigInt(value: DatabaseIdentifier, fieldName: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ValidationRepositoryError(`${fieldName} must be a safe integer`);
    }
    return BigInt(value);
  }
  try {
    return parseBigInt(value, fieldName);
  } catch (error) {
    throw new ValidationRepositoryError(`${fieldName} must be a base-10 integer`, { cause: error });
  }
}

export function positiveBigInt(value: DatabaseIdentifier, fieldName: string): bigint {
  const parsed = toBigInt(value, fieldName);
  if (parsed <= 0n) throw new ValidationRepositoryError(`${fieldName} must be positive`);
  return parsed;
}

export function nonNegativeBigInt(value: DatabaseIdentifier, fieldName: string): bigint {
  const parsed = toBigInt(value, fieldName);
  if (parsed < 0n) throw new ValidationRepositoryError(`${fieldName} must be non-negative`);
  return parsed;
}

export function nonEmpty(value: string, fieldName: string, maxLength?: number): string {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (normalized === "") throw new ValidationRepositoryError(`${fieldName} must not be empty`);
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new ValidationRepositoryError(`${fieldName} must be at most ${maxLength} characters`);
  }
  return normalized;
}

export function optionalText(
  value: string | null | undefined,
  fieldName: string,
  maxLength?: number,
): string | null {
  if (value === undefined || value === null) return null;
  return nonEmpty(value, fieldName, maxLength);
}

export function validDate(value: Date | undefined, fieldName: string): Date | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ValidationRepositoryError(`${fieldName} must be a valid Date`);
  }
  return value;
}

export function effectiveNow(value?: Date): Date {
  const result = value === undefined ? new Date() : new Date(value.getTime());
  if (!Number.isFinite(result.getTime())) throw new ValidationRepositoryError("now must be a valid Date");
  return result;
}

export function jsonPayload(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  return { ...value };
}

export function repositoryCall<T>(operation: string, callback: () => Promise<T>): Promise<T> {
  return callback().catch((error: unknown) => {
    throw mapDatabaseError(error, operation);
  });
}

export async function firstOrUndefined<T>(query: Promise<T[]>): Promise<T | undefined> {
  const rows = await query;
  return rows[0];
}

export function sameBigInt(left: bigint, right: DatabaseIdentifier, fieldName: string): boolean {
  return left === toBigInt(right, fieldName);
}
