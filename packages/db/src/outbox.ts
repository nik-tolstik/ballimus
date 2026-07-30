import { and, asc, eq, isNotNull, lte, or, sql } from "drizzle-orm";

import type { AppDatabase } from "./client.js";
import {
  outbox,
  outboxEventTypes,
  type OutboxDeliveryState,
  type OutboxEvent,
  type OutboxEventType,
} from "./schema.js";
import { serializeDatabaseValue } from "./serialization.js";
import {
  effectiveNow,
  nonEmpty,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
  toBigInt,
} from "./repositories/common.js";
import {
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./repositories/errors.js";

export interface InsertOutboxEventInput {
  readonly eventType: OutboxEventType;
  readonly deduplicationKey: string;
  readonly matchId?: DatabaseIdentifier | null;
  readonly notificationId?: DatabaseIdentifier | null;
  readonly telegramChatId: DatabaseIdentifier;
  readonly telegramTopicId?: DatabaseIdentifier | null;
  readonly payload?: Record<string, unknown>;
  readonly availableAt?: Date;
  readonly createdAt?: Date;
}

export type OutboxInsertResult =
  | { readonly status: "inserted"; readonly event: OutboxEvent }
  | { readonly status: "duplicate"; readonly event: OutboxEvent };

export interface ClaimOutboxOptions {
  readonly limit?: number;
  readonly leaseDurationMs?: number;
  readonly now?: Date;
}

function eventId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "outboxId");
}

function chatId(value: DatabaseIdentifier): bigint {
  const parsed = toBigInt(value, "telegramChatId");
  if (parsed === 0n) throw new ValidationRepositoryError("telegramChatId must be non-zero");
  return parsed;
}

function topicId(value: DatabaseIdentifier | null | undefined): bigint | null {
  if (value === undefined || value === null) return null;
  return positiveBigInt(value, "telegramTopicId");
}

function payload(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const serialized = serializeDatabaseValue(value ?? {});
  if (serialized === null || serialized === undefined || Array.isArray(serialized) || typeof serialized !== "object") {
    throw new ValidationRepositoryError("outbox payload must be a JSON object");
  }
  return serialized;
}

function validateEventType(value: OutboxEventType): void {
  if (!outboxEventTypes.includes(value)) throw new ValidationRepositoryError("Unsupported outbox event type");
}

function validateLease(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000) {
    throw new ValidationRepositoryError("leaseDurationMs must be between 1ms and 24h");
  }
}

/** Durable post-commit effects with unique deduplication keys and leased delivery claims. */
export class OutboxRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async findById(id: DatabaseIdentifier): Promise<OutboxEvent | undefined> {
    const rows = await this.db.select().from(outbox).where(eq(outbox.id, eventId(id))).limit(1);
    return rows[0];
  }

  public async findByDeduplicationKey(deduplicationKey: string): Promise<OutboxEvent | undefined> {
    const rows = await this.db.select().from(outbox).where(eq(outbox.deduplicationKey, nonEmpty(deduplicationKey, "deduplicationKey", 500))).limit(1);
    return rows[0];
  }

  public async insert(input: InsertOutboxEventInput): Promise<OutboxInsertResult> {
    return this.db.transaction(async (tx) => new OutboxRepository(tx).insertInTransaction(input));
  }

  public async insertInTransaction(input: InsertOutboxEventInput): Promise<OutboxInsertResult> {
    validateEventType(input.eventType);
    const deduplicationKey = nonEmpty(input.deduplicationKey, "deduplicationKey", 500);
    const matchId = input.matchId === undefined || input.matchId === null ? null : positiveBigInt(input.matchId, "matchId");
    const notificationId = input.notificationId === undefined || input.notificationId === null ? null : positiveBigInt(input.notificationId, "notificationId");
    if (input.eventType === "send_notification" && notificationId === null) {
      throw new ValidationRepositoryError("send_notification events require notificationId");
    }
    if (input.eventType !== "send_notification" && matchId === null) {
      throw new ValidationRepositoryError(`${input.eventType} events require matchId`);
    }
    const now = effectiveNow(input.createdAt);
    const availableAt = input.availableAt === undefined ? now : effectiveNow(input.availableAt);
    const inserted = await this.db
      .insert(outbox)
      .values({
        eventType: input.eventType,
        deduplicationKey,
        matchId,
        notificationId,
        telegramChatId: chatId(input.telegramChatId),
        telegramTopicId: topicId(input.telegramTopicId),
        payload: payload(input.payload),
        deliveryState: "pending",
        attemptCount: 0,
        availableAt,
        lockedAt: null,
        leaseExpiresAt: null,
        deliveredAt: null,
        uncertainAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: outbox.deduplicationKey })
      .returning();
    const event = inserted[0];
    if (event !== undefined) return { status: "inserted", event };
    const existing = await this.findByDeduplicationKey(deduplicationKey);
    if (existing === undefined) throw new RepositoryConflictError("Outbox deduplication claim was lost concurrently");
    return { status: "duplicate", event: existing };
  }

  public async enqueue(input: InsertOutboxEventInput): Promise<OutboxInsertResult> {
    return this.insert(input);
  }

  public async enqueueInTransaction(input: InsertOutboxEventInput): Promise<OutboxInsertResult> {
    return this.insertInTransaction(input);
  }

  public async insertMany(inputs: readonly InsertOutboxEventInput[]): Promise<OutboxEvent[]> {
    return this.db.transaction(async (tx) => {
      const repository = new OutboxRepository(tx);
      const events: OutboxEvent[] = [];
      for (const input of inputs) {
        const result = await repository.insertInTransaction(input);
        events.push(result.event);
      }
      return events;
    });
  }

  /** Claims pending/failed/expired-processing events under row locks and returns the lease-bearing rows. */
  public async claim(options: ClaimOutboxOptions = {}): Promise<OutboxEvent[]> {
    return this.db.transaction(async (tx) => new OutboxRepository(tx).claimInTransaction(options));
  }

  public async claimInTransaction(options: ClaimOutboxOptions = {}): Promise<OutboxEvent[]> {
    const limit = options.limit ?? 20;
    const leaseDurationMs = options.leaseDurationMs ?? 60_000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ValidationRepositoryError("outbox claim limit must be 1..500");
    validateLease(leaseDurationMs);
    const now = effectiveNow(options.now);
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const candidates = await this.db
      .select()
      .from(outbox)
      .where(or(
        and(eq(outbox.deliveryState, "pending"), lte(outbox.availableAt, now)),
        and(eq(outbox.deliveryState, "failed"), lte(outbox.availableAt, now)),
        and(eq(outbox.deliveryState, "processing"), lte(outbox.leaseExpiresAt, now), isNotNull(outbox.leaseExpiresAt)),
      ))
      .orderBy(asc(outbox.availableAt), asc(outbox.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    const claimed: OutboxEvent[] = [];
    for (const candidate of candidates) {
      const rows = await this.db
        .update(outbox)
        .set({
          deliveryState: "processing",
          attemptCount: sql`${outbox.attemptCount} + 1`,
          lockedAt: now,
          leaseExpiresAt,
          deliveredAt: null,
          uncertainAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(outbox.id, candidate.id))
        .returning();
      const event = rows[0];
      if (event !== undefined) claimed.push(event);
    }
    return claimed;
  }

  public async claimPending(options: ClaimOutboxOptions = {}): Promise<OutboxEvent[]> {
    return this.claim(options);
  }

  public async markDelivered(id: DatabaseIdentifier, deliveredAt?: Date): Promise<OutboxEvent> {
    const parsedId = eventId(id);
    const now = effectiveNow(deliveredAt);
    const rows = await this.db
      .update(outbox)
      .set({ deliveryState: "delivered", deliveredAt: now, uncertainAt: null, lockedAt: null, leaseExpiresAt: null, lastError: null, updatedAt: now })
      .where(and(eq(outbox.id, parsedId), or(eq(outbox.deliveryState, "processing"), eq(outbox.deliveryState, "delivered"))))
      .returning();
    const event = rows[0];
    if (event !== undefined) return event;
    throw new RepositoryConflictError(`Outbox event ${parsedId} is not deliverable`);
  }

  public async markFailed(
    id: DatabaseIdentifier,
    error: string,
    options: { readonly availableAt?: Date; readonly failedAt?: Date } = {},
  ): Promise<OutboxEvent> {
    return this.updateDeliveryFailure(id, "failed", error, options.failedAt, options.availableAt);
  }

  public async markUncertain(id: DatabaseIdentifier, error: string, uncertainAt?: Date): Promise<OutboxEvent> {
    return this.updateDeliveryFailure(id, "uncertain", error, uncertainAt, undefined);
  }

  public async retry(id: DatabaseIdentifier, availableAt = new Date()): Promise<OutboxEvent> {
    const parsedId = eventId(id);
    const now = effectiveNow();
    const rows = await this.db
      .update(outbox)
      .set({ deliveryState: "pending", availableAt: effectiveNow(availableAt), lockedAt: null, leaseExpiresAt: null, deliveredAt: null, uncertainAt: null, lastError: null, updatedAt: now })
      .where(and(eq(outbox.id, parsedId), or(eq(outbox.deliveryState, "failed"), eq(outbox.deliveryState, "uncertain"))))
      .returning();
    const event = rows[0];
    if (event === undefined) throw new RepositoryConflictError(`Outbox event ${parsedId} is not retryable`);
    return event;
  }

  public async listPending(limit = 100): Promise<OutboxEvent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ValidationRepositoryError("limit must be positive");
    return this.db
      .select()
      .from(outbox)
      .where(or(eq(outbox.deliveryState, "pending"), eq(outbox.deliveryState, "failed")))
      .orderBy(asc(outbox.availableAt), asc(outbox.id))
      .limit(limit);
  }

  public async listUncertain(limit = 100): Promise<OutboxEvent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ValidationRepositoryError("limit must be positive");
    return this.db
      .select()
      .from(outbox)
      .where(eq(outbox.deliveryState, "uncertain"))
      .orderBy(asc(outbox.updatedAt), asc(outbox.id))
      .limit(limit);
  }

  private async updateDeliveryFailure(
    id: DatabaseIdentifier,
    state: Extract<OutboxDeliveryState, "failed" | "uncertain">,
    error: string,
    occurredAt?: Date,
    availableAt?: Date,
  ): Promise<OutboxEvent> {
    const parsedId = eventId(id);
    const lastError = nonEmpty(error, "lastError", 2_000);
    const now = effectiveNow(occurredAt);
    const rows = await this.db
      .update(outbox)
      .set({
        deliveryState: state,
        availableAt: availableAt === undefined ? now : effectiveNow(availableAt),
        lockedAt: null,
        leaseExpiresAt: null,
        deliveredAt: null,
        uncertainAt: state === "uncertain" ? now : null,
        lastError,
        updatedAt: now,
      })
      .where(and(eq(outbox.id, parsedId), or(eq(outbox.deliveryState, "processing"), eq(outbox.deliveryState, "failed"), eq(outbox.deliveryState, "uncertain"))))
      .returning();
    const event = rows[0];
    if (event === undefined) throw new NotFoundRepositoryError(`Outbox event ${parsedId} was not found or is already delivered`);
    return event;
  }
}

export function createOutboxRepository(db: AppDatabase): OutboxRepository {
  return new OutboxRepository(db);
}
