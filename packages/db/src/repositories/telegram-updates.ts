import { and, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import { telegramUpdates, type TelegramUpdate } from "../schema.js";
import { effectiveNow, nonNegativeBigInt, type DatabaseExecutor, type DatabaseIdentifier } from "./common.js";
import { NotFoundRepositoryError, RepositoryConflictError, ValidationRepositoryError } from "./errors.js";

export type TelegramUpdateClaimResult =
  | { readonly status: "claimed"; readonly update: TelegramUpdate }
  | { readonly status: "duplicate"; readonly update: TelegramUpdate };

function updateId(value: DatabaseIdentifier): bigint {
  return nonNegativeBigInt(value, "updateId");
}

/** Globally unique webhook update claims. A claim is normally committed with its business transaction. */
export class TelegramUpdatesRepository {
  public constructor(private readonly db: DatabaseExecutor) {}

  public async findByUpdateId(value: DatabaseIdentifier): Promise<TelegramUpdate | undefined> {
    const rows = await this.db.select().from(telegramUpdates).where(eq(telegramUpdates.updateId, updateId(value))).limit(1);
    return rows[0];
  }

  public async claim(value: DatabaseIdentifier, receivedAt?: Date): Promise<TelegramUpdateClaimResult> {
    return this.db.transaction(async (tx) => new TelegramUpdatesRepository(tx).claimInTransaction(value, receivedAt));
  }

  public async claimInTransaction(
    value: DatabaseIdentifier,
    receivedAt?: Date,
  ): Promise<TelegramUpdateClaimResult> {
    const parsedId = updateId(value);
    const now = effectiveNow(receivedAt);
    const inserted = await this.db
      .insert(telegramUpdates)
      .values({ updateId: parsedId, status: "processing", receivedAt: now, attemptCount: 1 })
      .onConflictDoNothing({ target: telegramUpdates.updateId })
      .returning();
    const created = inserted[0];
    if (created !== undefined) return { status: "claimed", update: created };
    const existing = await this.findByUpdateId(parsedId);
    if (existing === undefined) throw new RepositoryConflictError("Telegram update claim was lost concurrently");
    return { status: "duplicate", update: existing };
  }

  public async markProcessed(value: DatabaseIdentifier, processedAt?: Date): Promise<TelegramUpdate> {
    return this.db.transaction(async (tx) => new TelegramUpdatesRepository(tx).markProcessedInTransaction(value, processedAt));
  }

  public async markProcessedInTransaction(value: DatabaseIdentifier, processedAt?: Date): Promise<TelegramUpdate> {
    const parsedId = updateId(value);
    const now = effectiveNow(processedAt);
    const rows = await this.db
      .update(telegramUpdates)
      .set({ status: "processed", processedAt: now, failedAt: null, lastError: null })
      .where(and(eq(telegramUpdates.updateId, parsedId), eq(telegramUpdates.status, "processing")))
      .returning();
    const update = rows[0];
    if (update === undefined) {
      const existing = await this.findByUpdateId(parsedId);
      if (existing === undefined) throw new NotFoundRepositoryError(`Telegram update ${parsedId} was not found`);
      if (existing.status === "processed") return existing;
      throw new RepositoryConflictError(`Telegram update ${parsedId} is not processing`, {
        details: { status: existing.status },
      });
    }
    return update;
  }

  public async markFailed(
    value: DatabaseIdentifier,
    error: string,
    failedAt?: Date,
  ): Promise<TelegramUpdate> {
    return this.db.transaction(async (tx) => new TelegramUpdatesRepository(tx).markFailedInTransaction(value, error, failedAt));
  }

  public async markFailedInTransaction(
    value: DatabaseIdentifier,
    error: string,
    failedAt?: Date,
  ): Promise<TelegramUpdate> {
    const parsedId = updateId(value);
    const lastError = error.trim();
    if (lastError === "") throw new ValidationRepositoryError("Telegram update failure must include an error");
    const rows = await this.db
      .update(telegramUpdates)
      .set({ status: "failed", failedAt: effectiveNow(failedAt), processedAt: null, lastError })
      .where(and(eq(telegramUpdates.updateId, parsedId), eq(telegramUpdates.status, "processing")))
      .returning();
    const update = rows[0];
    if (update === undefined) throw new RepositoryConflictError(`Telegram update ${parsedId} is not processing`);
    return update;
  }

  /** Explicitly reclaims a failed update; processed updates remain permanently idempotent. */
  public async retryFailed(value: DatabaseIdentifier, receivedAt?: Date): Promise<TelegramUpdate> {
    return this.db.transaction(async (tx) => {
      const parsedId = updateId(value);
      const now = effectiveNow(receivedAt);
      const rows = await tx
        .update(telegramUpdates)
        .set({ status: "processing", attemptCount: sql`${telegramUpdates.attemptCount} + 1`, receivedAt: now, failedAt: null, lastError: null })
        .where(and(eq(telegramUpdates.updateId, parsedId), eq(telegramUpdates.status, "failed")))
        .returning();
      const update = rows[0];
      if (update === undefined) {
        const existing = await new TelegramUpdatesRepository(tx).findByUpdateId(parsedId);
        if (existing === undefined) throw new NotFoundRepositoryError(`Telegram update ${parsedId} was not found`);
        if (existing.status === "processed") throw new RepositoryConflictError("Processed Telegram updates cannot be retried");
        return existing;
      }
      return update;
    });
  }
}

export function createTelegramUpdatesRepository(db: AppDatabase): TelegramUpdatesRepository {
  return new TelegramUpdatesRepository(db);
}
