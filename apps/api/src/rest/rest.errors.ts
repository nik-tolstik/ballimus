import { HttpException, type HttpStatus } from "@nestjs/common";
import {
  IdempotencyConflictError,
  isPersistenceError,
  OptimisticConcurrencyError,
  type PersistenceError,
} from "@football/db";

export interface RestErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface RestErrorMapping {
  readonly status: number;
  readonly body: RestErrorBody;
}

/** An application error whose message and details are safe for the REST boundary. */
export class RestRequestError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RestRequestError";
  }
}

export function restRequestError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RestRequestError {
  return new RestRequestError(status, code, message, details);
}

function persistenceMapping(error: PersistenceError): RestErrorMapping {
  switch (error.code) {
    case "not_found":
      return {
        status: 404,
        body: { code: "RESOURCE_NOT_FOUND", message: "The requested resource was not found." },
      };
    case "forbidden":
      return {
        status: 403,
        body: { code: "FORBIDDEN", message: "The requested operation is not allowed." },
      };
    case "invalid":
      return {
        status: 400,
        body: { code: "VALIDATION_ERROR", message: "The request contains invalid values." },
      };
    case "idempotency_conflict":
      return {
        status: 409,
        body: {
          code: "IDEMPOTENCY_KEY_CONFLICT",
          message: "The idempotency key was already used for a different request.",
        },
      };
    case "duplicate":
      return {
        status: 409,
        body: { code: "DUPLICATE_RESOURCE", message: "The requested resource already exists." },
      };
    case "conflict":
      return {
        status: 409,
        body: { code: "CONFLICT", message: "The requested operation conflicts with current state." },
      };
    case "unavailable":
      return {
        status: 503,
        body: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable." },
      };
  }
}

function httpExceptionMapping(error: HttpException): RestErrorMapping {
  const response = error.getResponse();
  if (typeof response === "object" && response !== null && !Array.isArray(response)) {
    return { status: error.getStatus(), body: response as RestErrorBody };
  }
  return {
    status: error.getStatus(),
    body: { code: "HTTP_ERROR", message: typeof response === "string" ? response : "Request failed." },
  };
}

export function mapRestError(error: unknown): RestErrorMapping {
  if (error instanceof HttpException) return httpExceptionMapping(error);
  if (error instanceof RestRequestError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  if (error instanceof OptimisticConcurrencyError) {
    return {
      status: 409,
      body: {
        code: "MATCH_VERSION_STALE",
        message: "The match was changed by another request; reload it before saving.",
        details: {
          expectedVersion: error.expectedVersion,
          ...(error.actualVersion === undefined ? {} : { actualVersion: error.actualVersion }),
        },
      },
    };
  }
  if (error instanceof IdempotencyConflictError) {
    return {
      status: 409,
      body: {
        code: "IDEMPOTENCY_KEY_CONFLICT",
        message: "The idempotency key was already used for a different request.",
      },
    };
  }
  if (isPersistenceError(error)) return persistenceMapping(error);
  return {
    status: 500,
    body: { code: "INTERNAL_ERROR", message: "The server could not complete the request." },
  };
}

export function toRestHttpException(error: unknown): HttpException {
  const mapped = mapRestError(error);
  return new HttpException(mapped.body, mapped.status as HttpStatus);
}
