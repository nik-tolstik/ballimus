import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { matches, type Match } from "../schema.js";
import {
  effectiveNow,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
  validDate,
} from "./common.js";
import {
  NotFoundRepositoryError,
  OptimisticConcurrencyError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";

export interface CreateMatchInput {
  readonly telegramChatId: DatabaseIdentifier;
  readonly scheduledAt: Date;
  readonly venueId: DatabaseIdentifier;
  readonly fieldPriceRubles?: number | null;
  readonly creatorTelegramUserId: DatabaseIdentifier;
  readonly createdAt?: Date;
}

export interface UpdateMatchInput {
  readonly scheduledAt?: Date;
  readonly venueId?: DatabaseIdentifier;
  readonly fieldPriceRubles?: number | null;
  readonly expectedVersion?: number;
  readonly now?: Date;
}

export interface MatchListOptions {
  readonly telegramChatId?: DatabaseIdentifier;
  readonly venueId?: DatabaseIdentifier;
  readonly includeDeletionRequested?: boolean;
}

function matchId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "matchId");
}

function nonZero(value: DatabaseIdentifier, field: string): bigint {
  const parsed = BigInt(typeof value === "number" ? String(value) : value);
  if (parsed === 0n) throw new ValidationRepositoryError(`${field} must be non-zero`);
  return parsed;
}

function expectedVersion(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationRepositoryError("expectedVersion must be a positive safe integer");
  }
  return value;
}

function fieldPrice(value: number | null | undefined): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationRepositoryError("fieldPriceRubles must be a non-negative safe integer");
  }
  return value;
}

function requireRecord(record: Match | undefined, id: bigint): Match {
  if (record === undefined) throw new NotFoundRepositoryError(`Match ${id.toString(10)} was not found`);
  return record;
}

/** Repository for scheduled, read-only public match cards. */
export class MatchesRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async findById(id: DatabaseIdentifier): Promise<Match | undefined> {
    const rows = await this.db.select().from(matches).where(eq(matches.id, matchId(id))).limit(1);
    return rows[0];
  }

  public async getById(id: DatabaseIdentifier): Promise<Match> {
    return requireRecord(await this.findById(id), matchId(id));
  }

  public async findForUpdate(id: DatabaseIdentifier): Promise<Match | undefined> {
    const rows = await this.db.select().from(matches).where(eq(matches.id, matchId(id))).limit(1).for("update");
    return rows[0];
  }

  public async getForUpdate(id: DatabaseIdentifier): Promise<Match> {
    return requireRecord(await this.findForUpdate(id), matchId(id));
  }

  public async create(input: CreateMatchInput): Promise<Match> {
    validDate(input.scheduledAt, "scheduledAt");
    const price = fieldPrice(input.fieldPriceRubles);
    const now = effectiveNow(input.createdAt);
    const rows = await this.db.insert(matches).values({
      telegramChatId: nonZero(input.telegramChatId, "telegramChatId"),
      scheduledAt: input.scheduledAt,
      venueId: positiveBigInt(input.venueId, "venueId"),
      fieldPriceRubles: price ?? null,
      creatorTelegramUserId: positiveBigInt(input.creatorTelegramUserId, "creatorTelegramUserId"),
      deletionRequestedAt: null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return requireRecord(rows[0], 0n);
  }

  public async update(id: DatabaseIdentifier, input: UpdateMatchInput): Promise<Match> {
    const parsedId = matchId(id);
    const current = await this.getForUpdate(parsedId);
    const version = expectedVersion(input.expectedVersion);
    if (version !== undefined && current.version !== version) {
      throw new OptimisticConcurrencyError(version, current.version);
    }
    if (current.deletionRequestedAt !== null) {
      throw new RepositoryConflictError("The match is already being deleted");
    }
    if (input.scheduledAt !== undefined) validDate(input.scheduledAt, "scheduledAt");
    const price = fieldPrice(input.fieldPriceRubles);
    const rows = await this.db.update(matches).set({
      ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
      ...(input.venueId === undefined ? {} : { venueId: positiveBigInt(input.venueId, "venueId") }),
      ...(price === undefined ? {} : { fieldPriceRubles: price }),
      version: sql`${matches.version} + 1`,
      updatedAt: effectiveNow(input.now),
    }).where(and(eq(matches.id, parsedId), ...(version === undefined ? [] : [eq(matches.version, version)]))).returning();
    return requireRecord(rows[0], parsedId);
  }

  public async requestDeletion(id: DatabaseIdentifier, expected?: number, now?: Date): Promise<Match> {
    const parsedId = matchId(id);
    const current = await this.getForUpdate(parsedId);
    if (current.deletionRequestedAt !== null) return current;
    const version = expectedVersion(expected);
    if (version !== undefined && current.version !== version) {
      throw new OptimisticConcurrencyError(version, current.version);
    }
    const rows = await this.db.update(matches).set({
      deletionRequestedAt: effectiveNow(now),
      version: sql`${matches.version} + 1`,
    }).where(eq(matches.id, parsedId)).returning();
    return requireRecord(rows[0], parsedId);
  }

  public async list(options: MatchListOptions = {}): Promise<Match[]> {
    const conditions = [
      ...(options.telegramChatId === undefined ? [] : [eq(matches.telegramChatId, nonZero(options.telegramChatId, "telegramChatId"))]),
      ...(options.venueId === undefined ? [] : [eq(matches.venueId, positiveBigInt(options.venueId, "venueId"))]),
      ...(options.includeDeletionRequested === true ? [] : [isNull(matches.deletionRequestedAt)]),
    ];
    return this.db.select().from(matches).where(and(...conditions)).orderBy(asc(matches.scheduledAt), asc(matches.id));
  }

  /** Removes one match only after its queued Telegram deletion was delivered. */
  public async deleteIfDeletionRequested(id: DatabaseIdentifier): Promise<boolean> {
    const rows = await this.db
      .delete(matches)
      .where(and(eq(matches.id, matchId(id)), isNotNull(matches.deletionRequestedAt)))
      .returning({ id: matches.id });
    return rows.length > 0;
  }
}
