import { createHash } from "node:crypto";

import { and, eq, lte } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import { httpIdempotencyKeys, type HttpIdempotencyKey } from "../schema.js";
import { serializeDatabaseValue } from "../serialization.js";
import {
  effectiveNow,
  nonEmpty,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
} from "./common.js";
import {
  IdempotencyConflictError,
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";

export interface BeginIdempotencyInput {
  readonly ownerTelegramUserId: DatabaseIdentifier;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly expiresAt: Date;
  readonly now?: Date;
}

export type IdempotencyBeginResult =
  | { readonly status: "started"; readonly record: HttpIdempotencyKey }
  | { readonly status: "replay"; readonly record: HttpIdempotencyKey }
  | { readonly status: "in_progress"; readonly record: HttpIdempotencyKey };

export interface IdempotencyResponse {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

function ownerId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "ownerTelegramUserId");
}

function key(value: string): string {
  return nonEmpty(value, "idempotencyKey", 255);
}

function requestHash(value: string): string {
  return nonEmpty(value, "requestHash", 1_000);
}

function validResponseStatus(value: number): void {
  if (!Number.isSafeInteger(value) || value < 100 || value > 599) {
    throw new ValidationRepositoryError("response status must be an HTTP status from 100 to 599");
  }
}

function responseBody(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (value === null) return null;
  const serialized = serializeDatabaseValue(value);
  if (serialized === undefined || serialized === null || Array.isArray(serialized) || typeof serialized !== "object") {
    throw new ValidationRepositoryError("response body must be a JSON object");
  }
  return serialized;
}

/** Durable owner-scoped idempotency keys with hash conflicts and response replay. */
export class HttpIdempotencyRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async begin(input: BeginIdempotencyInput): Promise<IdempotencyBeginResult> {
    return this.db.transaction(async (tx) => new HttpIdempotencyRepository(tx).beginInTransaction(input));
  }

  public async beginInTransaction(input: BeginIdempotencyInput): Promise<IdempotencyBeginResult> {
    const ownerTelegramUserId = ownerId(input.ownerTelegramUserId);
    const idempotencyKey = key(input.idempotencyKey);
    const hash = requestHash(input.requestHash);
    const now = effectiveNow(input.now);
    if (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= now) {
      throw new ValidationRepositoryError("expiresAt must be a future valid Date");
    }
    let existing = await this.findForUpdateInTransaction(ownerTelegramUserId, idempotencyKey);
    if (existing !== undefined && existing.expiresAt <= now) {
      await this.db
        .delete(httpIdempotencyKeys)
        .where(and(eq(httpIdempotencyKeys.ownerTelegramUserId, ownerTelegramUserId), eq(httpIdempotencyKeys.idempotencyKey, idempotencyKey)));
      existing = undefined;
    }
    if (existing !== undefined) {
      if (existing.requestHash !== hash) {
        throw new IdempotencyConflictError("The idempotency key was reused with a different request hash", {
          details: { ownerTelegramUserId, idempotencyKey },
        });
      }
      if (existing.status === "processing") return { status: "in_progress", record: existing };
      return { status: "replay", record: existing };
    }
    const rows = await this.db
      .insert(httpIdempotencyKeys)
      .values({
        ownerTelegramUserId,
        idempotencyKey,
        requestHash: hash,
        status: "processing",
        responseStatus: null,
        responseBody: null,
        expiresAt: input.expiresAt,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const record = rows[0];
    if (record === undefined) throw new RepositoryConflictError("The idempotency key was not created");
    return { status: "started", record };
  }

  public async get(
    ownerTelegramUserId: DatabaseIdentifier,
    idempotencyKey: string,
    now?: Date,
  ): Promise<HttpIdempotencyKey | undefined> {
    const record = await this.find(ownerTelegramUserId, idempotencyKey);
    if (record !== undefined && now !== undefined && record.expiresAt <= now) return undefined;
    return record;
  }

  public async find(ownerTelegramUserId: DatabaseIdentifier, idempotencyKey: string): Promise<HttpIdempotencyKey | undefined> {
    const rows = await this.db
      .select()
      .from(httpIdempotencyKeys)
      .where(and(
        eq(httpIdempotencyKeys.ownerTelegramUserId, ownerId(ownerTelegramUserId)),
        eq(httpIdempotencyKeys.idempotencyKey, key(idempotencyKey)),
      ))
      .limit(1);
    return rows[0];
  }

  public async complete(
    id: DatabaseIdentifier,
    response: IdempotencyResponse,
    completedAt?: Date,
  ): Promise<HttpIdempotencyKey> {
    return this.finish(id, "succeeded", response, completedAt);
  }

  public async succeed(
    id: DatabaseIdentifier,
    response: IdempotencyResponse,
    completedAt?: Date,
  ): Promise<HttpIdempotencyKey> {
    return this.complete(id, response, completedAt);
  }

  public async fail(
    id: DatabaseIdentifier,
    response: IdempotencyResponse,
    completedAt?: Date,
  ): Promise<HttpIdempotencyKey> {
    return this.finish(id, "failed", response, completedAt);
  }

  public async expire(now = new Date()): Promise<number> {
    const timestamp = effectiveNow(now);
    const rows = await this.db
      .delete(httpIdempotencyKeys)
      .where(lte(httpIdempotencyKeys.expiresAt, timestamp))
      .returning({ id: httpIdempotencyKeys.id });
    return rows.length;
  }

  private async finish(
    id: DatabaseIdentifier,
    status: "succeeded" | "failed",
    response: IdempotencyResponse,
    completedAt?: Date,
  ): Promise<HttpIdempotencyKey> {
    validResponseStatus(response.status);
    const now = effectiveNow(completedAt);
    const rows = await this.db
      .update(httpIdempotencyKeys)
      .set({
        status,
        responseStatus: response.status,
        responseBody: responseBody(response.body),
        completedAt: now,
        updatedAt: now,
      })
      .where(and(eq(httpIdempotencyKeys.id, positiveBigInt(id, "idempotencyId")), eq(httpIdempotencyKeys.status, "processing")))
      .returning();
    const record = rows[0];
    if (record !== undefined) return record;
    const existing = await this.db.select().from(httpIdempotencyKeys).where(eq(httpIdempotencyKeys.id, positiveBigInt(id, "idempotencyId"))).limit(1);
    const current = existing[0];
    if (current === undefined) throw new NotFoundRepositoryError(`Idempotency record ${String(id)} was not found`);
    if (current.status === status && current.responseStatus === response.status) return current;
    throw new RepositoryConflictError("The idempotency record is no longer processing", { details: { status: current.status } });
  }

  private async findForUpdateInTransaction(ownerTelegramUserId: bigint, idempotencyKey: string): Promise<HttpIdempotencyKey | undefined> {
    const rows = await this.db
      .select()
      .from(httpIdempotencyKeys)
      .where(and(eq(httpIdempotencyKeys.ownerTelegramUserId, ownerTelegramUserId), eq(httpIdempotencyKeys.idempotencyKey, idempotencyKey)))
      .limit(1)
      .for("update");
    return rows[0];
  }
}

export function createHttpIdempotencyRepository(db: AppDatabase): HttpIdempotencyRepository {
  return new HttpIdempotencyRepository(db);
}

/** Produces the request-hash format expected by the idempotency repository. */
export function hashIdempotencyRequest(value: unknown): string {
  const normalized = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString(10);
    if (item instanceof Date) return item.toISOString();
    return item;
  });
  return createHash("sha256").update(normalized ?? "null").digest("hex");
}
