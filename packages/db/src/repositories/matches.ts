import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  matchStatuses,
  matches,
  type Match,
  type MatchStatus,
  type MatchTimeMode,
  type VenueType,
} from "../schema.js";
import {
  effectiveNow,
  nonEmpty,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
  toBigInt,
  validDate,
} from "./common.js";
import {
  NotFoundRepositoryError,
  OptimisticConcurrencyError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";

export interface CreateMatchInput {
  readonly telegramChatId?: DatabaseIdentifier;
  readonly chatId?: DatabaseIdentifier;
  readonly scheduledAt?: Date | null;
  readonly scheduleDate?: string | null;
  readonly timeMode?: MatchTimeMode;
  readonly timeOptions?: readonly string[];
  readonly selectedTime?: string | null;
  readonly venueId?: DatabaseIdentifier | null;
  readonly location?: string | null;
  readonly venueType?: VenueType | null;
  readonly fieldPriceRubles?: number | null;
  readonly title?: string | null;
  readonly requiredPlayers: number;
  readonly creatorTelegramUserId: DatabaseIdentifier;
  readonly status?: MatchStatus;
  readonly cancellationReason?: string | null;
  readonly createdAt?: Date;
}

export interface UpdateMatchInput {
  readonly scheduledAt?: Date | null;
  readonly scheduleDate?: string | null;
  readonly timeMode?: MatchTimeMode;
  readonly timeOptions?: readonly string[];
  readonly selectedTime?: string | null;
  readonly venueId?: DatabaseIdentifier | null;
  readonly location?: string | null;
  readonly venueType?: VenueType | null;
  readonly fieldPriceRubles?: number | null;
  readonly title?: string | null;
  readonly requiredPlayers?: number;
  readonly cancellationReason?: string | null;
  readonly expectedVersion?: number;
  readonly ifMatch?: number;
  readonly now?: Date;
}

export interface TransitionMatchInput {
  readonly to: MatchStatus;
  readonly cancellationReason?: string | null;
  readonly scheduledAt?: Date | null;
  readonly selectedTime?: string | null;
  readonly expectedVersion?: number;
  readonly ifMatch?: number;
  readonly now?: Date;
}

export interface MatchListOptions {
  readonly telegramChatId?: DatabaseIdentifier;
  readonly chatId?: DatabaseIdentifier;
  readonly statuses?: readonly MatchStatus[];
  readonly limit?: number;
  readonly offset?: number;
  readonly venueId?: DatabaseIdentifier;
}

export interface SyncVenueDetailsInput {
  readonly venueId: DatabaseIdentifier;
  readonly location: string;
  readonly venueType: VenueType;
  readonly title: string | null;
  readonly now?: Date;
}

export interface ScheduledMatchWindow {
  readonly start: Date;
  readonly end: Date;
  readonly telegramChatId?: DatabaseIdentifier;
}

const lifecycleTransitions: Readonly<Record<MatchStatus, readonly MatchStatus[]>> = {
  draft: ["active"],
  active: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function matchId(id: DatabaseIdentifier): bigint {
  return positiveBigInt(id, "matchId");
}

function chatId(input: CreateMatchInput | MatchListOptions | ScheduledMatchWindow): bigint | undefined {
  const value = input.telegramChatId ?? ("chatId" in input ? input.chatId : undefined);
  return value === undefined ? undefined : toBigInt(value, "telegramChatId");
}

function expectedVersion(input: { readonly expectedVersion?: number; readonly ifMatch?: number }): number | undefined {
  const value = input.expectedVersion ?? input.ifMatch;
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationRepositoryError("expectedVersion must be a positive safe integer");
  }
  return value;
}

function normalizeCancellationReason(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return nonEmpty(value, "cancellationReason", 500);
}

function validateRequiredPlayers(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationRepositoryError("requiredPlayers must be a positive safe integer");
  }
}

function validatePrice(value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationRepositoryError("fieldPriceRubles must be a non-negative safe integer");
  }
}

function validateStatus(status: MatchStatus): void {
  if (!matchStatuses.includes(status)) throw new ValidationRepositoryError("status is not supported");
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function normalizeTimeConfiguration(input: {
  readonly timeMode?: MatchTimeMode;
  readonly timeOptions?: readonly string[];
  readonly scheduleDate?: string | null;
  readonly selectedTime?: string | null;
}): { readonly timeMode: MatchTimeMode; readonly timeOptions: string[]; readonly scheduleDate: string | null; readonly selectedTime: string | null } {
  const timeMode = input.timeMode ?? "exact";
  const scheduleDate = input.scheduleDate ?? null;
  const selectedTime = input.selectedTime ?? null;
  const timeOptions = [...new Set((input.timeOptions ?? []).map((value) => value.trim()))].sort();
  if (scheduleDate !== null && !LOCAL_DATE_PATTERN.test(scheduleDate)) {
    throw new ValidationRepositoryError("scheduleDate must use YYYY-MM-DD or null");
  }
  if (timeMode === "exact") {
    if (timeOptions.length > 0 || selectedTime !== null) {
      throw new ValidationRepositoryError("exact matches cannot contain availability time options");
    }
  } else if (
    scheduleDate === null
    || timeOptions.length < 1
    || timeOptions.length > 6
    || timeOptions.some((value) => !LOCAL_TIME_PATTERN.test(value))
    || (selectedTime !== null && !timeOptions.includes(selectedTime))
  ) {
    throw new ValidationRepositoryError("time-option matches require a date, 1-6 unique time options, and an optional selected option");
  }
  return { timeMode, timeOptions, scheduleDate, selectedTime };
}

function requireUpdatedMatch(match: Match | undefined, id: bigint): Match {
  if (match === undefined) throw new NotFoundRepositoryError(`Match ${id.toString(10)} was not updated`);
  return match;
}

/** Async PostgreSQL repository for structured matches and versioned lifecycle changes. */
export class MatchesRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async findById(id: DatabaseIdentifier): Promise<Match | undefined> {
    const rows = await this.db.select().from(matches).where(eq(matches.id, matchId(id))).limit(1);
    return rows[0];
  }

  public async getById(id: DatabaseIdentifier): Promise<Match> {
    const record = await this.findById(id);
    if (record === undefined) throw new NotFoundRepositoryError(`Match ${String(id)} was not found`);
    return record;
  }

  public async findForUpdate(id: DatabaseIdentifier): Promise<Match | undefined> {
    const rows = await this.db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId(id)))
      .limit(1)
      .for("update");
    return rows[0];
  }

  public async getForUpdate(id: DatabaseIdentifier): Promise<Match> {
    const record = await this.findForUpdate(id);
    if (record === undefined) throw new NotFoundRepositoryError(`Match ${String(id)} was not found`);
    return record;
  }

  public async create(input: CreateMatchInput): Promise<Match> {
    const telegramChatId = chatId(input);
    if (telegramChatId === undefined || telegramChatId === 0n) {
      throw new ValidationRepositoryError("telegramChatId must be non-zero");
    }
    const creatorTelegramUserId = positiveBigInt(
      input.creatorTelegramUserId,
      "creatorTelegramUserId",
    );
    validateRequiredPlayers(input.requiredPlayers);
    validatePrice(input.fieldPriceRubles);
    validDate(input.scheduledAt === undefined || input.scheduledAt === null ? undefined : input.scheduledAt, "scheduledAt");
    const status = input.status ?? "draft";
    validateStatus(status);
    const cancellationReason = normalizeCancellationReason(input.cancellationReason);
    if (status !== "cancelled" && cancellationReason !== null) {
      throw new ValidationRepositoryError("cancellationReason is only valid for cancelled matches");
    }
    if (status === "cancelled" && cancellationReason === null) {
      throw new ValidationRepositoryError("cancellationReason is required for cancelled matches");
    }
    const now = effectiveNow(input.createdAt);
    const location = input.location === undefined || input.location === null
      ? null
      : nonEmpty(input.location, "location", 200);
    const title = input.title === undefined || input.title === null
      ? null
      : nonEmpty(input.title, "title", 500);
    const timeConfiguration = normalizeTimeConfiguration(input);
    const venueId = input.venueId === undefined || input.venueId === null
      ? null
      : positiveBigInt(input.venueId, "venueId");

    const rows = await this.db
      .insert(matches)
      .values({
        telegramChatId,
        scheduledAt: input.scheduledAt ?? null,
        scheduleDate: timeConfiguration.scheduleDate,
        timeMode: timeConfiguration.timeMode,
        timeOptions: timeConfiguration.timeOptions,
        selectedTime: timeConfiguration.selectedTime,
        venueId,
        location,
        venueType: input.venueType ?? null,
        fieldPriceRubles: input.fieldPriceRubles ?? null,
        title,
        requiredPlayers: input.requiredPlayers,
        status,
        cancellationReason,
        creatorTelegramUserId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const record = rows[0];
    if (record === undefined) throw new NotFoundRepositoryError("Match was not created");
    return record;
  }

  public async update(id: DatabaseIdentifier, input: UpdateMatchInput): Promise<Match> {
    const parsedId = matchId(id);
    const expected = expectedVersion(input);
    const current = await this.getForUpdate(parsedId);
    if (expected !== undefined && current.version !== expected) {
      throw new OptimisticConcurrencyError(expected, current.version);
    }
    if (current.status === "completed" || current.status === "cancelled") {
      throw new RepositoryConflictError(`Match ${parsedId.toString(10)} is no longer editable`, {
        details: { status: current.status },
      });
    }
    if (input.scheduledAt !== undefined) validDate(input.scheduledAt ?? undefined, "scheduledAt");
    const changesTimeConfiguration = input.scheduleDate !== undefined
      || input.timeMode !== undefined
      || input.timeOptions !== undefined
      || input.selectedTime !== undefined;
    const timeConfiguration = changesTimeConfiguration
      ? normalizeTimeConfiguration({
        scheduleDate: input.scheduleDate === undefined ? current.scheduleDate : input.scheduleDate,
        timeMode: input.timeMode ?? current.timeMode,
        timeOptions: input.timeOptions ?? current.timeOptions,
        selectedTime: input.selectedTime === undefined ? current.selectedTime : input.selectedTime,
      })
      : undefined;
    validatePrice(input.fieldPriceRubles);
    if (input.requiredPlayers !== undefined) validateRequiredPlayers(input.requiredPlayers);
    const cancellationReason = input.cancellationReason === undefined
      ? undefined
      : normalizeCancellationReason(input.cancellationReason);
    if (cancellationReason !== undefined) {
      throw new ValidationRepositoryError("cancellationReason cannot be set on a non-cancelled match");
    }
    const setValues: {
      scheduledAt?: Date | null;
      scheduleDate?: string | null;
      timeMode?: MatchTimeMode;
      timeOptions?: string[];
      selectedTime?: string | null;
      venueId?: bigint | null;
      location?: string | null;
      venueType?: VenueType | null;
      fieldPriceRubles?: number | null;
      title?: string | null;
      requiredPlayers?: number;
      cancellationReason?: string | null;
      version: ReturnType<typeof sql>;
      updatedAt: Date;
    } = {
      version: sql`${matches.version} + 1`,
      updatedAt: effectiveNow(input.now),
    };
    if (input.scheduledAt !== undefined) setValues.scheduledAt = input.scheduledAt;
    if (timeConfiguration !== undefined) {
      setValues.scheduleDate = timeConfiguration.scheduleDate;
      setValues.timeMode = timeConfiguration.timeMode;
      setValues.timeOptions = timeConfiguration.timeOptions;
      setValues.selectedTime = timeConfiguration.selectedTime;
    }
    if (input.location !== undefined) {
      setValues.location = input.location === null ? null : nonEmpty(input.location, "location", 200);
    }
    if (input.venueId !== undefined) {
      setValues.venueId = input.venueId === null ? null : positiveBigInt(input.venueId, "venueId");
    }
    if (input.venueType !== undefined) setValues.venueType = input.venueType;
    if (input.fieldPriceRubles !== undefined) setValues.fieldPriceRubles = input.fieldPriceRubles;
    if (input.title !== undefined) {
      setValues.title = input.title === null ? null : nonEmpty(input.title, "title", 500);
    }
    if (input.requiredPlayers !== undefined) setValues.requiredPlayers = input.requiredPlayers;
    if (cancellationReason !== undefined) setValues.cancellationReason = cancellationReason;

    const rows = await this.db
      .update(matches)
      .set(setValues)
      .where(and(eq(matches.id, parsedId), ...(expected === undefined ? [] : [eq(matches.version, expected)])))
      .returning();
    return requireUpdatedMatch(rows[0], parsedId);
  }

  public async updateIfMatch(
    id: DatabaseIdentifier,
    version: number,
    input: Omit<UpdateMatchInput, "expectedVersion" | "ifMatch">,
  ): Promise<Match> {
    return this.update(id, { ...input, expectedVersion: version });
  }

  public async transitionStatus(id: DatabaseIdentifier, input: TransitionMatchInput): Promise<Match> {
    const parsedId = matchId(id);
    const expected = expectedVersion(input);
    const current = await this.getForUpdate(parsedId);
    if (expected !== undefined && current.version !== expected) {
      throw new OptimisticConcurrencyError(expected, current.version);
    }
    validateStatus(input.to);
    if (!lifecycleTransitions[current.status].includes(input.to)) {
      throw new RepositoryConflictError(
        `Cannot transition match from ${current.status} to ${input.to}`,
        { details: { from: current.status, to: input.to } },
      );
    }
    const cancellationReason = input.to === "cancelled"
      ? normalizeCancellationReason(input.cancellationReason)
      : null;
    if (input.to === "cancelled" && cancellationReason === null) {
      throw new ValidationRepositoryError("cancellationReason is required when cancelling a match");
    }
    if (input.to !== "cancelled" && input.cancellationReason !== undefined && input.cancellationReason !== null) {
      throw new ValidationRepositoryError("cancellationReason is only valid when cancelling a match");
    }
    if (input.scheduledAt !== undefined) validDate(input.scheduledAt ?? undefined, "scheduledAt");
    if (input.selectedTime !== undefined) {
      normalizeTimeConfiguration({
        scheduleDate: current.scheduleDate,
        timeMode: current.timeMode,
        timeOptions: current.timeOptions,
        selectedTime: input.selectedTime,
      });
    }
    const rows = await this.db
      .update(matches)
      .set({
        status: input.to,
        cancellationReason,
        ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
        ...(input.selectedTime === undefined ? {} : { selectedTime: input.selectedTime }),
        version: sql`${matches.version} + 1`,
        updatedAt: effectiveNow(input.now),
      })
      .where(and(eq(matches.id, parsedId), ...(expected === undefined ? [] : [eq(matches.version, expected)])))
      .returning();
    return requireUpdatedMatch(rows[0], parsedId);
  }

  public async updateStatus(
    id: DatabaseIdentifier,
    status: MatchStatus,
    options: Omit<TransitionMatchInput, "to"> = {},
  ): Promise<Match> {
    return this.transitionStatus(id, { ...options, to: status });
  }

  public async list(options: MatchListOptions = {}): Promise<Match[]> {
    const conditions = [];
    const telegramChatId = chatId(options);
    if (telegramChatId !== undefined) conditions.push(eq(matches.telegramChatId, telegramChatId));
    if (options.statuses !== undefined) {
      if (options.statuses.length === 0) return [];
      options.statuses.forEach(validateStatus);
      conditions.push(inArray(matches.status, [...options.statuses]));
    }
    if (options.venueId !== undefined) conditions.push(eq(matches.venueId, positiveBigInt(options.venueId, "venueId")));
    const query = this.db
      .select()
      .from(matches)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(matches.scheduleDate), desc(matches.scheduledAt), desc(matches.id));
    if (options.limit !== undefined) {
      if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
        throw new ValidationRepositoryError("limit must be a positive safe integer");
      }
      query.limit(options.limit);
    }
    if (options.offset !== undefined) {
      if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
        throw new ValidationRepositoryError("offset must be a non-negative safe integer");
      }
      query.offset(options.offset);
    }
    return query;
  }

  /** Updates denormalized match details after an owner edits a linked venue, including history. */
  public async syncVenueDetails(id: DatabaseIdentifier, input: SyncVenueDetailsInput): Promise<Match> {
    const parsedId = matchId(id);
    const parsedVenueId = positiveBigInt(input.venueId, "venueId");
    const rows = await this.db
      .update(matches)
      .set({
        location: nonEmpty(input.location, "location", 200),
        venueType: input.venueType,
        title: input.title === null ? null : nonEmpty(input.title, "title", 500),
        version: sql`${matches.version} + 1`,
        updatedAt: effectiveNow(input.now),
      })
      .where(and(eq(matches.id, parsedId), eq(matches.venueId, parsedVenueId)))
      .returning();
    return requireUpdatedMatch(rows[0], parsedId);
  }

  public async listByChatId(telegramChatId: DatabaseIdentifier): Promise<Match[]> {
    return this.list({ telegramChatId });
  }

  public async listByStatus(
    telegramChatId: DatabaseIdentifier,
    status: MatchStatus,
  ): Promise<Match[]> {
    return this.list({ telegramChatId, statuses: [status] });
  }

  public async listHistory(
    telegramChatId?: DatabaseIdentifier,
    options: Omit<MatchListOptions, "telegramChatId" | "chatId" | "statuses"> = {},
  ): Promise<Match[]> {
    return this.list({
      ...options,
      ...(telegramChatId === undefined ? {} : { telegramChatId }),
      statuses: ["completed", "cancelled"],
    });
  }

  public async listScheduledBetween(input: ScheduledMatchWindow): Promise<Match[]> {
    validDate(input.start, "start");
    validDate(input.end, "end");
    if (input.start >= input.end) throw new ValidationRepositoryError("start must be before end");
    const conditions = [
      inArray(matches.status, ["active", "confirmed"] as const),
      gte(matches.scheduledAt, input.start),
      lte(matches.scheduledAt, input.end),
    ];
    const telegramChatId = chatId(input);
    if (telegramChatId !== undefined) conditions.push(eq(matches.telegramChatId, telegramChatId));
    return this.db.select().from(matches).where(and(...conditions)).orderBy(matches.scheduledAt);
  }

  public async delete(id: DatabaseIdentifier): Promise<boolean> {
    const rows = await this.db.delete(matches).where(eq(matches.id, matchId(id))).returning({ id: matches.id });
    return rows.length > 0;
  }
}

export function createMatchesRepository(db: AppDatabase): MatchesRepository {
  return new MatchesRepository(db);
}
