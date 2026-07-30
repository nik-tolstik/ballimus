import { and, asc, eq, isNull, or } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  matchMessages,
  matches,
  type MatchMessage,
  type PublicationState,
} from "../schema.js";
import {
  effectiveNow,
  nonEmpty,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
} from "./common.js";
import {
  NotFoundRepositoryError,
  ValidationRepositoryError,
} from "./errors.js";

export interface SaveMatchMessageInput {
  readonly matchId: DatabaseIdentifier;
  readonly telegramChatId?: DatabaseIdentifier;
  readonly chatId?: DatabaseIdentifier;
  readonly telegramTopicId?: DatabaseIdentifier | null;
  readonly topicId?: DatabaseIdentifier | null;
  readonly telegramMessageId?: DatabaseIdentifier | null;
  readonly messageId?: DatabaseIdentifier | null;
  readonly publicationState?: PublicationState;
  readonly attemptedAt?: Date;
  readonly lastError?: string | null;
}

export interface PublicMessageSource {
  readonly telegramChatId: DatabaseIdentifier;
  readonly telegramTopicId?: DatabaseIdentifier | null;
  readonly telegramMessageId: DatabaseIdentifier;
}

function matchId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "matchId");
}

function chatId(input: SaveMatchMessageInput): bigint {
  const value = input.telegramChatId ?? input.chatId;
  if (value === undefined) throw new ValidationRepositoryError("telegramChatId is required");
  const parsed = BigInt(typeof value === "number" ? String(value) : value);
  if (parsed === 0n) throw new ValidationRepositoryError("telegramChatId must be non-zero");
  return parsed;
}

function topicId(value: DatabaseIdentifier | null | undefined): bigint | null {
  if (value === undefined || value === null) return null;
  return positiveBigInt(value, "telegramTopicId");
}

function messageId(value: DatabaseIdentifier | null | undefined): bigint | null {
  if (value === undefined || value === null) return null;
  return positiveBigInt(value, "telegramMessageId");
}

function inferPublicationState(
  message: bigint | null,
  state: PublicationState | undefined,
): PublicationState {
  if (state !== undefined) return state;
  return message === null ? "pending" : "published";
}

function validateState(
  state: PublicationState,
  message: bigint | null,
  attemptedAt: Date | undefined,
  uncertainAt: Date | undefined,
  error: string | null,
): void {
  if (state === "published" || state === "deleted") {
    if (message === null) throw new ValidationRepositoryError(`${state} public cards require a Telegram message ID`);
  } else if (message !== null) {
    throw new ValidationRepositoryError(`${state} public cards cannot retain a Telegram message ID`);
  }
  if (state === "uncertain" && uncertainAt === undefined) throw new ValidationRepositoryError("uncertain publication requires uncertainAt");
  if (state !== "uncertain" && uncertainAt !== undefined) throw new ValidationRepositoryError("only uncertain publications may have uncertainAt");
  if (state === "pending" && attemptedAt !== undefined) throw new ValidationRepositoryError("pending publication cannot have attemptedAt");
  if (state !== "pending" && attemptedAt === undefined) throw new ValidationRepositoryError(`${state} publication requires attemptedAt`);
  if ((state === "failed" || state === "uncertain") && (error === null || error.trim() === "")) {
    throw new ValidationRepositoryError(`${state} publication requires an error`);
  }
  if ((state === "pending" || state === "published" || state === "deleted") && error !== null) {
    throw new ValidationRepositoryError(`${state} publication cannot have an error`);
  }
}

/** One durable public-card reference per match, including uncertain initial publication state. */
export class MatchMessagesRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async findByMatchId(matchId: DatabaseIdentifier): Promise<MatchMessage | undefined> {
    const rows = await this.db.select().from(matchMessages).where(eq(matchMessages.matchId, matchIdValue(matchId))).limit(1);
    return rows[0];
  }

  public async getByMatchId(matchId: DatabaseIdentifier): Promise<MatchMessage> {
    const message = await this.findByMatchId(matchId);
    if (message === undefined) throw new NotFoundRepositoryError(`Public card for match ${String(matchId)} was not found`);
    return message;
  }

  public async lookupBySource(source: PublicMessageSource): Promise<MatchMessage | undefined> {
    const rows = await this.db
      .select()
      .from(matchMessages)
      .where(and(
        eq(matchMessages.telegramChatId, sourceChatId(source)),
        source.telegramTopicId === null || source.telegramTopicId === undefined
          ? isNull(matchMessages.telegramTopicId)
          : eq(matchMessages.telegramTopicId, topicId(source.telegramTopicId) as bigint),
        eq(matchMessages.telegramMessageId, messageId(source.telegramMessageId) as bigint),
        or(eq(matchMessages.publicationState, "published"), eq(matchMessages.publicationState, "deleted")),
      ))
      .limit(1);
    return rows[0];
  }

  public async findByChatAndMessageId(
    telegramChatId: DatabaseIdentifier,
    telegramMessageId: DatabaseIdentifier,
    telegramTopicId?: DatabaseIdentifier | null,
  ): Promise<MatchMessage | undefined> {
    return this.lookupBySource(
      telegramTopicId === undefined
        ? { telegramChatId, telegramMessageId }
        : { telegramChatId, telegramMessageId, telegramTopicId },
    );
  }

  public async save(input: SaveMatchMessageInput): Promise<MatchMessage> {
    return this.db.transaction(async (tx) => new MatchMessagesRepository(tx).saveInTransaction(input));
  }

  public async saveInTransaction(input: SaveMatchMessageInput): Promise<MatchMessage> {
    const parsedMatchId = matchId(input.matchId);
    const telegramChatId = chatId(input);
    const telegramTopicId = topicId(input.telegramTopicId ?? input.topicId);
    const telegramMessageId = messageId(input.telegramMessageId ?? input.messageId);
    const matchRows = await this.db.select({ chatId: matches.telegramChatId }).from(matches).where(eq(matches.id, parsedMatchId)).limit(1);
    const match = matchRows[0];
    if (match === undefined) throw new NotFoundRepositoryError(`Match ${parsedMatchId} was not found`);
    if (match.chatId !== telegramChatId) throw new ValidationRepositoryError("Public card chat does not match the match chat");
    const state = inferPublicationState(telegramMessageId, input.publicationState);
    const now = effectiveNow(input.attemptedAt);
    const attemptedAt = state === "pending" ? null : now;
    const uncertainAt = state === "uncertain" ? now : null;
    const lastError = input.lastError === undefined || input.lastError === null
      ? null
      : nonEmpty(input.lastError, "lastError", 2_000);
    validateState(state, telegramMessageId, attemptedAt === null ? undefined : attemptedAt, uncertainAt === null ? undefined : uncertainAt, lastError);
    const rows = await this.db
      .insert(matchMessages)
      .values({
        matchId: parsedMatchId,
        telegramChatId,
        telegramTopicId,
        telegramMessageId,
        publicationState: state,
        publicationAttemptedAt: attemptedAt,
        publicationUncertainAt: uncertainAt,
        lastError,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: matchMessages.matchId,
        set: {
          telegramChatId,
          telegramTopicId,
          telegramMessageId,
          publicationState: state,
          publicationAttemptedAt: attemptedAt,
          publicationUncertainAt: uncertainAt,
          lastError,
          updatedAt: now,
        },
      })
      .returning();
    const record = rows[0];
    if (record === undefined) throw new NotFoundRepositoryError("Public card reference was not saved");
    return record;
  }

  public async upsert(input: SaveMatchMessageInput): Promise<MatchMessage> {
    return this.save(input);
  }

  public async createPending(
    matchId: DatabaseIdentifier,
    telegramChatId: DatabaseIdentifier,
    telegramTopicId?: DatabaseIdentifier | null,
  ): Promise<MatchMessage> {
    return this.save(
      telegramTopicId === undefined
        ? { matchId, telegramChatId, publicationState: "pending" }
        : { matchId, telegramChatId, telegramTopicId, publicationState: "pending" },
    );
  }

  public async markPublicationAttempt(matchId: DatabaseIdentifier, attemptedAt?: Date): Promise<MatchMessage> {
    return this.markUncertain(matchId, "Publication attempt did not reach a durable Telegram message ID", attemptedAt);
  }

  public async markPublished(
    matchId: DatabaseIdentifier,
    telegramMessageId: DatabaseIdentifier,
    attemptedAt?: Date,
  ): Promise<MatchMessage> {
    const parsedMatchId = matchIdValue(matchId);
    const message = positiveBigInt(telegramMessageId, "telegramMessageId");
    const now = effectiveNow(attemptedAt);
    const rows = await this.db
      .update(matchMessages)
      .set({
        telegramMessageId: message,
        publicationState: "published",
        publicationAttemptedAt: now,
        publicationUncertainAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(matchMessages.matchId, parsedMatchId))
      .returning();
    const record = rows[0];
    if (record === undefined) throw new NotFoundRepositoryError(`Public card for match ${parsedMatchId} was not found`);
    return record;
  }

  public async markUncertain(
    matchId: DatabaseIdentifier,
    error: string,
    attemptedAt?: Date,
  ): Promise<MatchMessage> {
    const parsedMatchId = matchIdValue(matchId);
    const now = effectiveNow(attemptedAt);
    const lastError = nonEmpty(error, "lastError", 2_000);
    const rows = await this.db
      .update(matchMessages)
      .set({
        telegramMessageId: null,
        publicationState: "uncertain",
        publicationAttemptedAt: now,
        publicationUncertainAt: now,
        lastError,
        updatedAt: now,
      })
      .where(eq(matchMessages.matchId, parsedMatchId))
      .returning();
    const record = rows[0];
    if (record === undefined) throw new NotFoundRepositoryError(`Public card for match ${parsedMatchId} was not found`);
    return record;
  }

  public async markFailed(matchId: DatabaseIdentifier, error: string, attemptedAt?: Date): Promise<MatchMessage> {
    const parsedMatchId = matchIdValue(matchId);
    const now = effectiveNow(attemptedAt);
    const lastError = nonEmpty(error, "lastError", 2_000);
    const rows = await this.db
      .update(matchMessages)
      .set({
        telegramMessageId: null,
        publicationState: "failed",
        publicationAttemptedAt: now,
        publicationUncertainAt: null,
        lastError,
        updatedAt: now,
      })
      .where(eq(matchMessages.matchId, parsedMatchId))
      .returning();
    const record = rows[0];
    if (record === undefined) throw new NotFoundRepositoryError(`Public card for match ${parsedMatchId} was not found`);
    return record;
  }

  /** Resets a failed or uncertain initial publication after an operator confirms that no card exists. */
  public async resetForRetry(matchId: DatabaseIdentifier, retriedAt?: Date): Promise<MatchMessage> {
    const parsedMatchId = matchIdValue(matchId);
    const now = effectiveNow(retriedAt);
    const rows = await this.db
      .update(matchMessages)
      .set({
        telegramMessageId: null,
        publicationState: "pending",
        publicationAttemptedAt: null,
        publicationUncertainAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(and(
        eq(matchMessages.matchId, parsedMatchId),
        or(eq(matchMessages.publicationState, "uncertain"), eq(matchMessages.publicationState, "failed")),
      ))
      .returning();
    const record = rows[0];
    if (record === undefined) {
      throw new ValidationRepositoryError("Only failed or uncertain public cards can be retried");
    }
    return record;
  }

  /** Records a successful Telegram deletion while retaining the source message for audit/reconciliation. */
  public async markDeleted(matchId: DatabaseIdentifier, deletedAt?: Date): Promise<MatchMessage | undefined> {
    const parsedMatchId = matchIdValue(matchId);
    const existing = await this.findByMatchId(parsedMatchId);
    if (existing === undefined) return undefined;
    if (existing.telegramMessageId === null) {
      await this.db.delete(matchMessages).where(eq(matchMessages.matchId, parsedMatchId));
      return undefined;
    }
    const now = effectiveNow(deletedAt);
    const rows = await this.db
      .update(matchMessages)
      .set({ publicationState: "deleted", publicationAttemptedAt: now, publicationUncertainAt: null, lastError: null, updatedAt: now })
      .where(eq(matchMessages.matchId, parsedMatchId))
      .returning();
    return rows[0];
  }

  public async delete(matchId: DatabaseIdentifier, deletedAt?: Date): Promise<boolean> {
    const result = await this.markDeleted(matchId, deletedAt);
    return result !== undefined;
  }

  public async listReconciliationCandidates(): Promise<MatchMessage[]> {
    return this.db
      .select()
      .from(matchMessages)
      .where(or(eq(matchMessages.publicationState, "uncertain"), eq(matchMessages.publicationState, "failed")))
      .orderBy(asc(matchMessages.updatedAt));
  }
}

function matchIdValue(value: DatabaseIdentifier): bigint {
  return matchId(value);
}

function sourceChatId(source: PublicMessageSource): bigint {
  const value = source.telegramChatId;
  const parsed = typeof value === "number" ? BigInt(value) : typeof value === "string" ? BigInt(value) : value;
  if (parsed === 0n) throw new ValidationRepositoryError("telegramChatId must be non-zero");
  return parsed;
}

export function createMatchMessagesRepository(db: AppDatabase): MatchMessagesRepository {
  return new MatchMessagesRepository(db);
}
