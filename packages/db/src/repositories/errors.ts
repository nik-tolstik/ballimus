export type PersistenceErrorCode =
  | "conflict"
  | "forbidden"
  | "not_found"
  | "duplicate"
  | "idempotency_conflict"
  | "invalid"
  | "unavailable";

export interface PersistenceErrorDetails {
  readonly [key: string]: unknown;
}

export interface PersistenceErrorOptions {
  readonly cause?: unknown;
  readonly details?: PersistenceErrorDetails;
}

/** A stable error contract for API adapters. Driver error messages stay internal to this package. */
export class PersistenceError extends Error {
  public readonly code: PersistenceErrorCode;
  public readonly details?: PersistenceErrorDetails;

  public constructor(
    code: PersistenceErrorCode,
    message: string,
    options: PersistenceErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PersistenceError";
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class RepositoryConflictError extends PersistenceError {
  public constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("conflict", message, options);
    this.name = "RepositoryConflictError";
  }
}

export class ForbiddenRepositoryError extends PersistenceError {
  public constructor(message = "The requested database operation is forbidden", options: PersistenceErrorOptions = {}) {
    super("forbidden", message, options);
    this.name = "ForbiddenRepositoryError";
  }
}

export class NotFoundRepositoryError extends PersistenceError {
  public constructor(message = "The requested record was not found", options: PersistenceErrorOptions = {}) {
    super("not_found", message, options);
    this.name = "NotFoundRepositoryError";
  }
}

export class DuplicateRepositoryError extends PersistenceError {
  public constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("duplicate", message, options);
    this.name = "DuplicateRepositoryError";
  }
}

export class IdempotencyConflictError extends PersistenceError {
  public constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("idempotency_conflict", message, options);
    this.name = "IdempotencyConflictError";
  }
}

export class OptimisticConcurrencyError extends RepositoryConflictError {
  public readonly expectedVersion: number;
  public readonly actualVersion?: number;

  public constructor(expectedVersion: number, actualVersion?: number) {
    super(
      actualVersion === undefined
        ? `The match version ${expectedVersion} is stale`
        : `The match version ${expectedVersion} is stale; current version is ${actualVersion}`,
      {
        details: { expectedVersion, ...(actualVersion === undefined ? {} : { actualVersion }) },
      },
    );
    this.name = "OptimisticConcurrencyError";
    this.expectedVersion = expectedVersion;
    if (actualVersion !== undefined) this.actualVersion = actualVersion;
  }
}

export class ValidationRepositoryError extends PersistenceError {
  public constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("invalid", message, options);
    this.name = "ValidationRepositoryError";
  }
}

export function isPersistenceError(error: unknown): error is PersistenceError {
  return error instanceof PersistenceError;
}

interface DriverErrorLike {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

function driverError(error: unknown): DriverErrorLike | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return error as DriverErrorLike;
}

/** Maps SQLSTATE/constraint failures to the stable repository error contract. */
export function mapDatabaseError(error: unknown, operation: string): PersistenceError {
  if (isPersistenceError(error)) return error;

  const candidate = driverError(error);
  const code = candidate?.code;
  const constraint = typeof candidate?.constraint === "string" ? candidate.constraint : "";
  if (code === "23505") {
    if (constraint.includes("http_idempotency")) {
      return new IdempotencyConflictError(`The idempotency key is already in use (${operation})`, { cause: error });
    }
    return new DuplicateRepositoryError(`A unique database record already exists (${operation})`, { cause: error });
  }
  if (code === "23514") {
    return new ValidationRepositoryError(`The database rejected an invalid ${operation}`, { cause: error });
  }
  if (code === "23503") {
    return new NotFoundRepositoryError(`A referenced record was not found (${operation})`, { cause: error });
  }
  return new PersistenceError("unavailable", `Database operation failed (${operation})`, { cause: error });
}
