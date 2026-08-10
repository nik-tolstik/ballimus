import { and, desc, eq } from "drizzle-orm";

import {
  telegramPolls,
  type TelegramPoll,
  type TelegramPollOptionState,
} from "../schema.js";
import {
  effectiveNow,
  nonEmpty,
  positiveBigInt,
  toBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
} from "./common.js";
import {
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";

export interface CreateTelegramPollOptionInput {
  readonly text: string;
  readonly notificationThreshold?: number | null;
}

export interface CreateTelegramPollInput {
  readonly telegramChatId: DatabaseIdentifier;
  readonly telegramTopicId?: DatabaseIdentifier | null;
  readonly question: string;
  readonly options: readonly CreateTelegramPollOptionInput[];
  readonly isAnonymous: boolean;
  readonly allowsMultipleAnswers: boolean;
  readonly creatorTelegramUserId: DatabaseIdentifier;
  readonly createdAt?: Date;
}

export interface TelegramPollUpdateOptionInput {
  readonly text: string;
  readonly voterCount: number;
}

export interface TelegramPollThresholdTrigger {
  readonly optionIndex: number;
  readonly optionText: string;
  readonly threshold: number;
  readonly voterCount: number;
}

export interface ApplyTelegramPollUpdateResult {
  readonly poll: TelegramPoll;
  readonly triggers: readonly TelegramPollThresholdTrigger[];
}

function requirePoll(poll: TelegramPoll | undefined, reference: string): TelegramPoll {
  if (poll === undefined) throw new NotFoundRepositoryError(`Telegram poll ${reference} was not found`);
  return poll;
}

function nonZero(value: DatabaseIdentifier, fieldName: string): bigint {
  const parsed = toBigInt(value, fieldName);
  if (parsed === 0n) throw new ValidationRepositoryError(`${fieldName} must be non-zero`);
  return parsed;
}

function optionalPositive(value: DatabaseIdentifier | null | undefined, fieldName: string): bigint | null {
  return value === undefined || value === null ? null : positiveBigInt(value, fieldName);
}

function threshold(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new ValidationRepositoryError("notificationThreshold must be an integer between 1 and 1000000");
  }
  return value;
}

function initialOptions(options: readonly CreateTelegramPollOptionInput[]): TelegramPollOptionState[] {
  if (options.length < 2 || options.length > 12) {
    throw new ValidationRepositoryError("A Telegram poll must contain between 2 and 12 options");
  }
  return options.map((option, index) => ({
    text: nonEmpty(option.text, `options[${index}].text`, 100),
    notificationThreshold: threshold(option.notificationThreshold),
    voterCount: 0,
    notificationQueuedAt: null,
  }));
}

function count(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationRepositoryError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

/** Persistence for native Telegram polls, isolated from matches and cards. */
export class TelegramPollsRepository {
  public constructor(private readonly db: DatabaseExecutor) {}

  public async create(input: CreateTelegramPollInput): Promise<TelegramPoll> {
    const now = effectiveNow(input.createdAt);
    const rows = await this.db.insert(telegramPolls).values({
      telegramPollId: null,
      telegramChatId: nonZero(input.telegramChatId, "telegramChatId"),
      telegramTopicId: optionalPositive(input.telegramTopicId, "telegramTopicId"),
      telegramMessageId: null,
      question: nonEmpty(input.question, "question", 300),
      options: initialOptions(input.options),
      isAnonymous: input.isAnonymous,
      allowsMultipleAnswers: input.allowsMultipleAnswers,
      publicationState: "pending",
      publicationAttemptedAt: null,
      closedAt: null,
      lastError: null,
      creatorTelegramUserId: positiveBigInt(input.creatorTelegramUserId, "creatorTelegramUserId"),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return requirePoll(rows[0], "new");
  }

  public async getById(id: DatabaseIdentifier): Promise<TelegramPoll> {
    const parsed = positiveBigInt(id, "pollId");
    const rows = await this.db.select().from(telegramPolls).where(eq(telegramPolls.id, parsed)).limit(1);
    return requirePoll(rows[0], parsed.toString(10));
  }

  public async listByChat(telegramChatId: DatabaseIdentifier, limit = 100): Promise<TelegramPoll[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      throw new ValidationRepositoryError("poll list limit must be between 1 and 250");
    }
    return this.db.select().from(telegramPolls)
      .where(eq(telegramPolls.telegramChatId, nonZero(telegramChatId, "telegramChatId")))
      .orderBy(desc(telegramPolls.createdAt), desc(telegramPolls.id))
      .limit(limit);
  }

  public async markPublished(
    id: DatabaseIdentifier,
    telegramPollId: string,
    telegramMessageId: DatabaseIdentifier,
    options: readonly TelegramPollUpdateOptionInput[],
    attemptedAt?: Date,
  ): Promise<TelegramPoll> {
    const parsedId = positiveBigInt(id, "pollId");
    const current = await this.getById(parsedId);
    const pollId = nonEmpty(telegramPollId, "telegramPollId", 255);
    const messageId = positiveBigInt(telegramMessageId, "telegramMessageId");
    if (current.publicationState === "published") {
      if (current.telegramPollId === pollId && current.telegramMessageId === messageId) return current;
      throw new RepositoryConflictError("The poll already has another Telegram publication reference");
    }
    if (current.publicationState !== "pending") {
      throw new RepositoryConflictError(`The poll cannot be published from state ${current.publicationState}`);
    }
    const mergedOptions = this.mergeOptions(current.options, options, undefined).options;
    const now = effectiveNow(attemptedAt);
    const rows = await this.db.update(telegramPolls).set({
      telegramPollId: pollId,
      telegramMessageId: messageId,
      options: mergedOptions,
      publicationState: "published",
      publicationAttemptedAt: now,
      lastError: null,
      updatedAt: now,
    }).where(and(eq(telegramPolls.id, parsedId), eq(telegramPolls.publicationState, "pending"))).returning();
    return requirePoll(rows[0], parsedId.toString(10));
  }

  public async markPublicationUncertain(id: DatabaseIdentifier, error: string, attemptedAt?: Date): Promise<TelegramPoll> {
    const parsedId = positiveBigInt(id, "pollId");
    const now = effectiveNow(attemptedAt);
    const rows = await this.db.update(telegramPolls).set({
      publicationState: "uncertain",
      publicationAttemptedAt: now,
      lastError: nonEmpty(error, "lastError", 2_000),
      updatedAt: now,
    }).where(and(eq(telegramPolls.id, parsedId), eq(telegramPolls.publicationState, "pending"))).returning();
    return requirePoll(rows[0], parsedId.toString(10));
  }

  public async getByTelegramPollIdForUpdate(telegramPollId: string): Promise<TelegramPoll | undefined> {
    const rows = await this.db.select().from(telegramPolls)
      .where(eq(telegramPolls.telegramPollId, nonEmpty(telegramPollId, "telegramPollId", 255)))
      .limit(1)
      .for("update");
    return rows[0];
  }

  public async applyTelegramUpdate(
    poll: TelegramPoll,
    options: readonly TelegramPollUpdateOptionInput[],
    isClosed: boolean,
    updatedAt?: Date,
  ): Promise<ApplyTelegramPollUpdateResult> {
    if (poll.publicationState !== "published") {
      throw new RepositoryConflictError("Only a published Telegram poll can receive updates");
    }
    const now = effectiveNow(updatedAt);
    const merged = this.mergeOptions(poll.options, options, now);
    const rows = await this.db.update(telegramPolls).set({
      options: merged.options,
      ...(isClosed && poll.closedAt === null ? { closedAt: now } : {}),
      updatedAt: now,
    }).where(eq(telegramPolls.id, poll.id)).returning();
    return { poll: requirePoll(rows[0], poll.id.toString(10)), triggers: merged.triggers };
  }

  private mergeOptions(
    current: readonly TelegramPollOptionState[],
    incoming: readonly TelegramPollUpdateOptionInput[],
    queuedAt: Date | undefined,
  ): { readonly options: TelegramPollOptionState[]; readonly triggers: TelegramPollThresholdTrigger[] } {
    if (incoming.length !== current.length) throw new ValidationRepositoryError("Telegram poll option count changed unexpectedly");
    const triggers: TelegramPollThresholdTrigger[] = [];
    const options = current.map((option, index) => {
      const next = incoming[index];
      if (next === undefined || next.text !== option.text) {
        throw new ValidationRepositoryError(`Telegram poll option ${index} no longer matches the published option`);
      }
      const voterCount = count(next.voterCount, `options[${index}].voterCount`);
      const reached = queuedAt !== undefined
        && option.notificationThreshold !== null
        && option.notificationQueuedAt === null
        && voterCount >= option.notificationThreshold;
      if (reached && option.notificationThreshold !== null) {
        triggers.push({ optionIndex: index, optionText: option.text, threshold: option.notificationThreshold, voterCount });
      }
      return {
        ...option,
        voterCount,
        notificationQueuedAt: reached && queuedAt !== undefined ? queuedAt.toISOString() : option.notificationQueuedAt,
      };
    });
    return { options, triggers };
  }
}
