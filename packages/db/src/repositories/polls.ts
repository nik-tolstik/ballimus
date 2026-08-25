import { and, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";

import {
  telegramPollVoteEvents,
  telegramPollVoterAnswers,
  telegramPolls,
  type TelegramPoll,
  type TelegramPollOptionState,
  type TelegramPollVoteEvent,
  type TelegramPollVoteEventKind,
  type TelegramPollVoterAnswer,
  type TelegramPollVoterKind,
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
  readonly notificationEnabled: boolean;
}

export interface CreateTelegramPollInput {
  readonly telegramChatId: DatabaseIdentifier;
  readonly telegramTopicId?: DatabaseIdentifier | null;
  readonly question: string;
  readonly options: readonly CreateTelegramPollOptionInput[];
  readonly notificationThreshold?: number | null;
  readonly isAnonymous: boolean;
  readonly allowsMultipleAnswers: boolean;
  readonly allowsRevoting: boolean;
  readonly creatorTelegramUserId: DatabaseIdentifier;
  readonly createdAt?: Date;
}

export interface TelegramPollUpdateOptionInput {
  readonly text: string;
  readonly voterCount: number;
}

/** Ordered notification settings for an existing native poll's immutable options. */
export interface TelegramPollNotificationSettingsInput {
  readonly notificationEnabled: readonly boolean[];
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

export interface TelegramPollVoterAnswerInput {
  readonly telegramUpdateId: DatabaseIdentifier;
  readonly voterKind: TelegramPollVoterKind;
  readonly telegramVoterId: DatabaseIdentifier;
  readonly username?: string | null;
  readonly displayName: string;
  readonly selectedOptionIndexes: readonly number[];
}

export interface TelegramPollWithdrawalTrigger {
  readonly optionIndex: number;
  readonly optionText: string;
  readonly threshold: number;
  readonly voterCount: number;
  readonly username: string | null;
  readonly displayName: string;
  readonly voterKind: TelegramPollVoterKind;
  readonly telegramVoterId: bigint;
}

export interface ApplyTelegramPollVoterAnswerResult {
  readonly triggers: readonly TelegramPollWithdrawalTrigger[];
}

export interface TelegramPollListOptions {
  readonly archived?: boolean;
  readonly limit?: number;
}

export interface TelegramPollVoteHistoryOptions {
  readonly beforeId?: DatabaseIdentifier;
  readonly limit?: number;
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

function notificationEnabled(value: boolean, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationRepositoryError(`${fieldName} must be a boolean`);
  }
  return value;
}

function initialOptions(options: readonly CreateTelegramPollOptionInput[]): TelegramPollOptionState[] {
  if (options.length < 2 || options.length > 12) {
    throw new ValidationRepositoryError("A Telegram poll must contain between 2 and 12 options");
  }
  return options.map((option, index) => ({
    text: nonEmpty(option.text, `options[${index}].text`, 100),
    notificationEnabled: notificationEnabled(option.notificationEnabled, `options[${index}].notificationEnabled`),
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

function nonNegativeBigInt(value: DatabaseIdentifier, fieldName: string): bigint {
  const parsed = toBigInt(value, fieldName);
  if (parsed < 0n) throw new ValidationRepositoryError(`${fieldName} must be non-negative`);
  return parsed;
}

function optionalUsername(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return nonEmpty(value, "username", 255);
}

function selectedOptionIndexes(values: readonly number[], optionCount: number): number[] {
  if (!Array.isArray(values)) throw new ValidationRepositoryError("selectedOptionIndexes must be an array");
  const unique = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= optionCount) {
      throw new ValidationRepositoryError("selectedOptionIndexes contains an invalid poll option index");
    }
    if (unique.has(value)) throw new ValidationRepositoryError("selectedOptionIndexes contains a duplicate poll option index");
    unique.add(value);
  }
  return [...unique].sort((left, right) => left - right);
}

function sameSelectedOptionIndexes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function voteEventKind(
  previousIndexes: readonly number[],
  nextIndexes: readonly number[],
): TelegramPollVoteEventKind | undefined {
  if (sameSelectedOptionIndexes(previousIndexes, nextIndexes)) return undefined;
  if (previousIndexes.length === 0) return "voted";
  if (nextIndexes.length === 0) return "cancelled";
  return "changed";
}

function voterCounts(optionCount: number, answers: readonly (readonly number[])[]): number[] {
  const counts = Array.from({ length: optionCount }, () => 0);
  for (const indexes of answers) {
    for (const index of selectedOptionIndexes(indexes, optionCount)) counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
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
      notificationThreshold: threshold(input.notificationThreshold),
      isAnonymous: input.isAnonymous,
      allowsMultipleAnswers: input.allowsMultipleAnswers,
      allowsRevoting: input.allowsRevoting,
      publicationState: "pending",
      publicationAttemptedAt: null,
      closedAt: null,
      archivedAt: null,
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

  public async getByIdForUpdate(id: DatabaseIdentifier): Promise<TelegramPoll> {
    const parsed = positiveBigInt(id, "pollId");
    const rows = await this.db.select().from(telegramPolls)
      .where(eq(telegramPolls.id, parsed))
      .limit(1)
      .for("update");
    return requirePoll(rows[0], parsed.toString(10));
  }

  public async listByChat(
    telegramChatId: DatabaseIdentifier,
    { archived = false, limit = 100 }: TelegramPollListOptions = {},
  ): Promise<TelegramPoll[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      throw new ValidationRepositoryError("poll list limit must be between 1 and 250");
    }
    return this.db.select().from(telegramPolls)
      .where(and(
        eq(telegramPolls.telegramChatId, nonZero(telegramChatId, "telegramChatId")),
        archived ? isNotNull(telegramPolls.archivedAt) : isNull(telegramPolls.archivedAt),
      ))
      .orderBy(
        ...(archived ? [desc(telegramPolls.archivedAt), desc(telegramPolls.id)] : [desc(telegramPolls.createdAt), desc(telegramPolls.id)]),
      )
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
    const mergedOptions = this.mergeOptions(current.options, options, current.notificationThreshold, undefined).options;
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

  public async markPublicationFailed(id: DatabaseIdentifier, error: string, attemptedAt?: Date): Promise<TelegramPoll> {
    const parsedId = positiveBigInt(id, "pollId");
    const now = effectiveNow(attemptedAt);
    const rows = await this.db.update(telegramPolls).set({
      publicationState: "failed",
      publicationAttemptedAt: now,
      lastError: nonEmpty(error, "lastError", 2_000),
      updatedAt: now,
    }).where(and(eq(telegramPolls.id, parsedId), eq(telegramPolls.publicationState, "pending"))).returning();
    return requirePoll(rows[0], parsedId.toString(10));
  }

  public async beginPublicationAttempt(id: DatabaseIdentifier, attemptedAt?: Date): Promise<TelegramPoll> {
    const parsedId = positiveBigInt(id, "pollId");
    const current = await this.getById(parsedId);
    if (current.archivedAt !== null) throw new RepositoryConflictError("An archived poll cannot be republished");
    if (current.publicationState !== "failed" && current.publicationState !== "uncertain") {
      throw new RepositoryConflictError(`The poll cannot be republished from state ${current.publicationState}`);
    }
    const now = effectiveNow(attemptedAt);
    const rows = await this.db.update(telegramPolls).set({
      publicationState: "pending",
      publicationAttemptedAt: null,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(telegramPolls.id, parsedId),
      or(eq(telegramPolls.publicationState, "failed"), eq(telegramPolls.publicationState, "uncertain")),
      isNull(telegramPolls.archivedAt),
    )).returning();
    return requirePoll(rows[0], parsedId.toString(10));
  }

  public async markPublicationCancelled(id: DatabaseIdentifier, attemptedAt?: Date): Promise<TelegramPoll> {
    const parsedId = positiveBigInt(id, "pollId");
    const current = await this.getById(parsedId);
    if (current.publicationState === "cancelled") return current;
    if (current.publicationState !== "pending" || current.archivedAt === null) {
      throw new RepositoryConflictError("Only an archived pending poll can cancel publication");
    }
    const now = effectiveNow(attemptedAt);
    const rows = await this.db.update(telegramPolls).set({
      publicationState: "cancelled",
      publicationAttemptedAt: now,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(telegramPolls.id, parsedId),
      eq(telegramPolls.publicationState, "pending"),
    )).returning();
    return requirePoll(rows[0], parsedId.toString(10));
  }

  public async archive(id: DatabaseIdentifier, archivedAt?: Date): Promise<TelegramPoll> {
    const parsedId = positiveBigInt(id, "pollId");
    const current = await this.getById(parsedId);
    if (current.archivedAt !== null) {
      await this.db.delete(telegramPollVoterAnswers).where(eq(telegramPollVoterAnswers.pollId, parsedId));
      return current;
    }
    const now = effectiveNow(archivedAt);
    const rows = await this.db.update(telegramPolls).set({
      archivedAt: now,
      updatedAt: now,
    }).where(and(eq(telegramPolls.id, parsedId), isNull(telegramPolls.archivedAt))).returning();
    const archived = requirePoll(rows[0], parsedId.toString(10));
    await this.db.delete(telegramPollVoterAnswers).where(eq(telegramPollVoterAnswers.pollId, parsedId));
    return archived;
  }

  /** Permanently removes a poll only after it has been archived. */
  public async deleteArchived(id: DatabaseIdentifier): Promise<boolean> {
    const parsedId = positiveBigInt(id, "pollId");
    const current = await this.getByIdForUpdate(parsedId);
    if (current.archivedAt === null) throw new RepositoryConflictError("Only an archived poll can be permanently deleted");
    const rows = await this.db.delete(telegramPolls)
      .where(and(eq(telegramPolls.id, parsedId), isNotNull(telegramPolls.archivedAt)))
      .returning({ id: telegramPolls.id });
    return rows.length > 0;
  }

  public async getByTelegramPollIdForUpdate(telegramPollId: string): Promise<TelegramPoll | undefined> {
    const rows = await this.db.select().from(telegramPolls)
      .where(eq(telegramPolls.telegramPollId, nonEmpty(telegramPollId, "telegramPollId", 255)))
      .limit(1)
      .for("update");
    return rows[0];
  }

  /**
   * Updates only the owner-controlled option notification toggles. The caller
   * must lock the row first so concurrent Telegram count updates preserve them.
   */
  public async updateNotificationSettings(
    poll: TelegramPoll,
    input: TelegramPollNotificationSettingsInput,
    updatedAt?: Date,
  ): Promise<TelegramPoll> {
    if (poll.archivedAt !== null) throw new RepositoryConflictError("An archived poll cannot be edited");
    if (!Array.isArray(input.notificationEnabled) || input.notificationEnabled.length !== poll.options.length) {
      throw new ValidationRepositoryError("notificationEnabled must contain one value for every poll option");
    }
    const options = poll.options.map((option, index) => ({
      ...option,
      notificationEnabled: notificationEnabled(input.notificationEnabled[index]!, `notificationEnabled[${index}]`),
    }));
    const now = effectiveNow(updatedAt);
    const rows = await this.db.update(telegramPolls).set({
      options,
      updatedAt: now,
    }).where(eq(telegramPolls.id, poll.id)).returning();
    return requirePoll(rows[0], poll.id.toString(10));
  }

  public async getVoterAnswer(
    pollId: DatabaseIdentifier,
    voterKind: TelegramPollVoterKind,
    telegramVoterId: DatabaseIdentifier,
  ): Promise<TelegramPollVoterAnswer | undefined> {
    const rows = await this.db.select().from(telegramPollVoterAnswers).where(and(
      eq(telegramPollVoterAnswers.pollId, positiveBigInt(pollId, "pollId")),
      eq(telegramPollVoterAnswers.voterKind, voterKind),
      eq(telegramPollVoterAnswers.telegramVoterId, nonZero(telegramVoterId, "telegramVoterId")),
    )).limit(1);
    return rows[0];
  }

  public async listVoteHistory(
    pollId: DatabaseIdentifier,
    { beforeId, limit = 50 }: TelegramPollVoteHistoryOptions = {},
  ): Promise<TelegramPollVoteEvent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      throw new ValidationRepositoryError("vote history limit must be between 1 and 250");
    }
    const parsedPollId = positiveBigInt(pollId, "pollId");
    const cursor = beforeId === undefined ? undefined : positiveBigInt(beforeId, "beforeId");
    return this.db.select().from(telegramPollVoteEvents)
      .where(and(
        eq(telegramPollVoteEvents.pollId, parsedPollId),
        ...(cursor === undefined ? [] : [lt(telegramPollVoteEvents.id, cursor)]),
      ))
      .orderBy(desc(telegramPollVoteEvents.id))
      .limit(limit);
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
    const merged = this.mergeOptions(poll.options, options, poll.notificationThreshold, now);
    const rows = await this.db.update(telegramPolls).set({
      options: merged.options,
      ...(isClosed && poll.closedAt === null ? { closedAt: now } : {}),
      updatedAt: now,
    }).where(eq(telegramPolls.id, poll.id)).returning();
    return { poll: requirePoll(rows[0], poll.id.toString(10)), triggers: merged.triggers };
  }

  public async applyTelegramVoterAnswer(
    poll: TelegramPoll,
    input: TelegramPollVoterAnswerInput,
    updatedAt?: Date,
  ): Promise<ApplyTelegramPollVoterAnswerResult> {
    if (poll.publicationState !== "published" || poll.archivedAt !== null) {
      throw new RepositoryConflictError("Only an active published Telegram poll can receive voter answers");
    }
    const telegramUpdateId = nonNegativeBigInt(input.telegramUpdateId, "telegramUpdateId");
    const telegramVoterId = nonZero(input.telegramVoterId, "telegramVoterId");
    const displayName = nonEmpty(input.displayName, "displayName", 255);
    const username = optionalUsername(input.username);
    const nextIndexes = selectedOptionIndexes(input.selectedOptionIndexes, poll.options.length);
    const answers = await this.db.select().from(telegramPollVoterAnswers)
      .where(eq(telegramPollVoterAnswers.pollId, poll.id));
    const current = answers.find((answer) => (
      answer.voterKind === input.voterKind && answer.telegramVoterId === telegramVoterId
    ));
    if (current !== undefined && current.lastTelegramUpdateId >= telegramUpdateId) return { triggers: [] };

    const beforeCounts = voterCounts(poll.options.length, answers.map((answer) => answer.selectedOptionIndexes));
    const previousIndexes = current?.selectedOptionIndexes ?? [];
    const eventKind = voteEventKind(previousIndexes, nextIndexes);
    if (eventKind === undefined) return { triggers: [] };
    const afterCounts = [...beforeCounts];
    for (const index of previousIndexes) afterCounts[index] = Math.max(0, (afterCounts[index] ?? 0) - 1);
    for (const index of nextIndexes) afterCounts[index] = (afterCounts[index] ?? 0) + 1;
    const nextIndexSet = new Set(nextIndexes);
    const thresholdValue = poll.notificationThreshold;
    const triggers: TelegramPollWithdrawalTrigger[] = [];
    if (thresholdValue !== null) {
      for (const index of previousIndexes) {
        const option = poll.options[index];
        const before = beforeCounts[index] ?? 0;
        const after = afterCounts[index] ?? 0;
        if (
          !nextIndexSet.has(index)
          && option?.notificationEnabled === true
          && before >= thresholdValue
          && after < thresholdValue
        ) {
          triggers.push({
            optionIndex: index,
            optionText: option.text,
            threshold: thresholdValue,
            voterCount: after,
            username,
            displayName,
            voterKind: input.voterKind,
            telegramVoterId,
          });
        }
      }
    }

    const now = effectiveNow(updatedAt);
    if (current === undefined) {
      await this.db.insert(telegramPollVoterAnswers).values({
        pollId: poll.id,
        voterKind: input.voterKind,
        telegramVoterId,
        username,
        displayName,
        selectedOptionIndexes: nextIndexes,
        lastTelegramUpdateId: telegramUpdateId,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await this.db.update(telegramPollVoterAnswers).set({
        username,
        displayName,
        selectedOptionIndexes: nextIndexes,
        lastTelegramUpdateId: telegramUpdateId,
        updatedAt: now,
      }).where(and(
        eq(telegramPollVoterAnswers.pollId, poll.id),
        eq(telegramPollVoterAnswers.voterKind, input.voterKind),
        eq(telegramPollVoterAnswers.telegramVoterId, telegramVoterId),
      ));
    }
    await this.db.insert(telegramPollVoteEvents).values({
      pollId: poll.id,
      kind: eventKind,
      voterKind: input.voterKind,
      telegramVoterId,
      username,
      displayName,
      previousSelectedOptionIndexes: previousIndexes,
      selectedOptionIndexes: nextIndexes,
      telegramUpdateId,
      occurredAt: now,
    });
    return { triggers };
  }

  private mergeOptions(
    current: readonly TelegramPollOptionState[],
    incoming: readonly TelegramPollUpdateOptionInput[],
    notificationThreshold: number | null,
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
      const notificationsEnabled = notificationThreshold !== null && option.notificationEnabled;
      const belowThreshold = notificationsEnabled && voterCount < notificationThreshold;
      const reached = queuedAt !== undefined
        && notificationsEnabled
        && option.voterCount < notificationThreshold
        && voterCount >= notificationThreshold;
      if (reached && notificationThreshold !== null) {
        triggers.push({ optionIndex: index, optionText: option.text, threshold: notificationThreshold, voterCount });
      }
      return {
        ...option,
        voterCount,
        notificationQueuedAt: belowThreshold
          ? null
          : reached && queuedAt !== undefined
            ? queuedAt.toISOString()
            : option.notificationQueuedAt,
      };
    });
    return { options, triggers };
  }
}
