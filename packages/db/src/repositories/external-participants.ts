import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  externalParticipants,
  type ExternalParticipant,
  type Match,
} from "../schema.js";
import {
  effectiveNow,
  nonEmpty,
  nonNegativeBigInt,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
} from "./common.js";
import {
  DuplicateRepositoryError,
  ForbiddenRepositoryError,
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";
import { MatchesRepository } from "./matches.js";
import { VotesRepository, type RosterCounts } from "./votes.js";
import { TelegramUpdatesRepository } from "./telegram-updates.js";

export interface AddExternalParticipantInput {
  readonly matchId: DatabaseIdentifier;
  readonly ownerTelegramUserId: DatabaseIdentifier;
  readonly quantity: number;
  /** A readable group/source label. Null means an unnamed owner-managed entry. */
  readonly displayName?: string | null;
  /** Earliest local time the participant can attend in an availability poll. Null means unknown. */
  readonly availableAfter?: string | null;
  readonly sourceUpdateId?: DatabaseIdentifier | null;
  readonly createdAt?: Date;
}

export interface ChangeExternalParticipantQuantityInput extends AddExternalParticipantInput {
  readonly quantity: number;
  readonly sourceDisplayName?: string | null;
}

export interface RemoveExternalParticipantInput {
  readonly id: DatabaseIdentifier;
  readonly ownerTelegramUserId: DatabaseIdentifier;
  readonly now?: Date;
}

export interface UpdateExternalParticipantInput {
  readonly id: DatabaseIdentifier;
  readonly ownerTelegramUserId: DatabaseIdentifier;
  readonly displayName?: string | null;
  readonly availableAfter?: string | null;
  readonly quantity?: number;
  readonly now?: Date;
}

export interface ExternalParticipantListOptions {
  readonly matchId?: DatabaseIdentifier;
  readonly createdByTelegramUserId?: DatabaseIdentifier;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ExternalParticipantMutationResult {
  readonly status: "added" | "updated" | "removed";
  readonly match: Match;
  readonly entry?: ExternalParticipant;
  readonly entries?: readonly ExternalParticipant[];
  readonly removedEntry?: ExternalParticipant;
  readonly countsBefore: RosterCounts;
  readonly countsAfter: RosterCounts;
  readonly thresholdReached: boolean;
  readonly thresholdLost: boolean;
}

export type TelegramExternalParticipantResult =
  | ExternalParticipantMutationResult
  | { readonly status: "duplicate"; readonly updateId: bigint };

function matchId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "matchId");
}

function participantId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "externalParticipantId");
}

function ownerId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "ownerTelegramUserId");
}

function validateQuantity(value: number): void {
  if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > 2_147_483_647) {
    throw new ValidationRepositoryError("quantity must be a non-zero PostgreSQL integer");
  }
}

export const MAX_EXTERNAL_PARTICIPANTS_PER_OPERATION = 50;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function validateAddQuantity(value: number): void {
  validateQuantity(value);
  if (value < 1 || value > MAX_EXTERNAL_PARTICIPANTS_PER_OPERATION) {
    throw new ValidationRepositoryError(
      `quantity must be between 1 and ${MAX_EXTERNAL_PARTICIPANTS_PER_OPERATION.toString(10)}`,
    );
  }
}

function normalizedDisplayName(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return nonEmpty(value, "displayName", 200);
}

function normalizedAvailableAfter(match: Pick<Match, "timeMode" | "timeOptions">, value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!LOCAL_TIME_PATTERN.test(normalized)) {
    throw new ValidationRepositoryError("availableAfter must be a local HH:mm time");
  }
  if (match.timeMode !== "availability") {
    throw new ValidationRepositoryError("availableAfter is only valid for availability matches");
  }
  if (!match.timeOptions.includes(normalized)) {
    throw new ValidationRepositoryError("availableAfter must be one of the match time options");
  }
  return normalized;
}

function individualDisplayName(source: string | null, position: number, total: number): string | null {
  if (total === 1) return source;
  const suffix = ` #${position.toString(10)}`;
  const base = source ?? "Дополнительный игрок";
  return `${base.slice(0, 200 - suffix.length).trimEnd()}${suffix}`;
}

function editable(match: Match): boolean {
  return match.status === "active" || match.status === "confirmed";
}

/** Owner-managed external players. Each persisted row represents exactly one person. */
export class ExternalParticipantsRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async findById(id: DatabaseIdentifier): Promise<ExternalParticipant | undefined> {
    const rows = await this.db
      .select()
      .from(externalParticipants)
      .where(eq(externalParticipants.id, participantId(id)))
      .limit(1);
    return rows[0];
  }

  public async findBySourceUpdateId(sourceUpdateId: DatabaseIdentifier): Promise<ExternalParticipant | undefined> {
    const rows = await this.db
      .select()
      .from(externalParticipants)
      .where(eq(externalParticipants.sourceUpdateId, nonNegativeBigInt(sourceUpdateId, "sourceUpdateId")))
      .limit(1);
    return rows[0];
  }

  public async listByMatchId(matchId: DatabaseIdentifier): Promise<ExternalParticipant[]> {
    return this.list({ matchId });
  }

  public async list(options: ExternalParticipantListOptions = {}): Promise<ExternalParticipant[]> {
    const conditions = [];
    if (options.matchId !== undefined) conditions.push(eq(externalParticipants.matchId, matchId(options.matchId)));
    if (options.createdByTelegramUserId !== undefined) {
      conditions.push(eq(externalParticipants.createdByTelegramUserId, ownerId(options.createdByTelegramUserId)));
    }
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
      throw new ValidationRepositoryError("limit must be a positive safe integer");
    }
    if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0)) {
      throw new ValidationRepositoryError("offset must be a non-negative safe integer");
    }
    const query = this.db
      .select()
      .from(externalParticipants)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(externalParticipants.createdAt), asc(externalParticipants.id));
    if (options.limit !== undefined) query.limit(options.limit);
    if (options.offset !== undefined) query.offset(options.offset);
    return query;
  }

  public async totalByMatchId(matchId: DatabaseIdentifier): Promise<number> {
    const rows = await this.db
      .select({ total: sql<unknown>`coalesce(sum(${externalParticipants.quantity}), 0)` })
      .from(externalParticipants)
      .where(eq(externalParticipants.matchId, matchIdValue(matchId)));
    const total = rows[0]?.total ?? 0;
    if (typeof total === "number") return total;
    if (typeof total === "bigint") return Number(total);
    const parsed = Number(total);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ValidationRepositoryError("External participant total is unsafe");
    return parsed;
  }

  public async countByMatchId(matchId: DatabaseIdentifier): Promise<number> {
    return this.totalByMatchId(matchId);
  }

  public async countByMatchIdAndSourceLabel(matchId: DatabaseIdentifier, displayName: string): Promise<number> {
    return this.totalForSource(matchId, normalizedDisplayName(displayName));
  }

  public async countByMatchIdWithoutSourceLabel(matchId: DatabaseIdentifier): Promise<number> {
    return this.totalForSource(matchId, null);
  }

  public async countByMatchIdAndAddedByTelegramUserId(
    matchId: DatabaseIdentifier,
    telegramUserId: DatabaseIdentifier,
  ): Promise<number> {
    const rows = await this.db
      .select({ total: sql<unknown>`coalesce(sum(${externalParticipants.quantity}), 0)` })
      .from(externalParticipants)
      .where(and(
        eq(externalParticipants.matchId, matchIdValue(matchId)),
        eq(externalParticipants.createdByTelegramUserId, ownerId(telegramUserId)),
        isNull(externalParticipants.displayName),
      ));
    return parseTotal(rows[0]?.total ?? 0);
  }

  public async add(input: AddExternalParticipantInput): Promise<ExternalParticipant | undefined> {
    const result = await this.addQuantity({ ...input, quantity: input.quantity });
    return result.entry;
  }

  public async addQuantity(input: AddExternalParticipantInput): Promise<ExternalParticipantMutationResult> {
    validateAddQuantity(input.quantity);
    return this.db.transaction(async (tx) => new ExternalParticipantsRepository(tx).addQuantityInTransaction(input));
  }

  public async addQuantityInTransaction(input: AddExternalParticipantInput): Promise<ExternalParticipantMutationResult> {
    validateAddQuantity(input.quantity);
    const match = await new MatchesRepository(this.db).getForUpdate(input.matchId);
    const creatorId = ownerId(input.ownerTelegramUserId);
    if (creatorId !== match.creatorTelegramUserId) {
      throw new ForbiddenRepositoryError("Only the configured match owner can manage external participants");
    }
    if (!editable(match)) throw new RepositoryConflictError(`Match ${match.id.toString(10)} is not editable`, { details: { status: match.status } });
    const existing = input.sourceUpdateId === undefined || input.sourceUpdateId === null
      ? undefined
      : await this.findBySourceUpdateId(input.sourceUpdateId);
    if (existing !== undefined) throw new DuplicateRepositoryError("The source Telegram update already created an external entry");
    const countsBefore = await new VotesRepository(this.db).rosterCounts(match.id);
    const now = effectiveNow(input.createdAt);
    const displayName = normalizedDisplayName(input.displayName);
    const availableAfter = normalizedAvailableAfter(match, input.availableAfter);
    const sourceUpdateId = input.sourceUpdateId === undefined || input.sourceUpdateId === null
      ? null
      : nonNegativeBigInt(input.sourceUpdateId, "sourceUpdateId");
    const rows = await this.db
      .insert(externalParticipants)
      .values(Array.from({ length: input.quantity }, (_, index) => ({
        matchId: match.id,
        createdByTelegramUserId: creatorId,
        sourceUpdateId: index === 0 ? sourceUpdateId : null,
        displayName: individualDisplayName(displayName, index + 1, input.quantity),
        availableAfter,
        quantity: 1,
        createdAt: now,
        updatedAt: now,
      })))
      .returning();
    const entry = rows[0];
    if (entry === undefined) throw new NotFoundRepositoryError("External participant entry was not created");
    const countsAfter = await new VotesRepository(this.db).rosterCounts(match.id);
    return { ...mutationResult("added", match, entry, countsBefore, countsAfter), entries: rows };
  }

  /** A Telegram-backed change claims the update in this same transaction. */
  public async addFromTelegram(input: AddExternalParticipantInput & { readonly updateId: DatabaseIdentifier }): Promise<TelegramExternalParticipantResult> {
    return this.db.transaction(async (tx) => new ExternalParticipantsRepository(tx).addFromTelegramInTransaction(input));
  }

  public async addFromTelegramInTransaction(input: AddExternalParticipantInput & { readonly updateId: DatabaseIdentifier }): Promise<TelegramExternalParticipantResult> {
    const updateId = nonNegativeBigInt(input.updateId, "updateId");
    const claim = await new TelegramUpdatesRepository(this.db).claimInTransaction(updateId, input.createdAt);
    if (claim.status === "duplicate") return { status: "duplicate", updateId };
    try {
      const result = await this.addQuantityInTransaction({ ...input, sourceUpdateId: updateId });
      await new TelegramUpdatesRepository(this.db).markProcessedInTransaction(updateId);
      return result;
    } catch (error) {
      await new TelegramUpdatesRepository(this.db).markFailedInTransaction(updateId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** Positive quantity adds a new entry; negative quantity consumes matching rows under row locks. */
  public async changeQuantity(input: ChangeExternalParticipantQuantityInput): Promise<ExternalParticipantMutationResult> {
    validateQuantity(input.quantity);
    return this.db.transaction(async (tx) => new ExternalParticipantsRepository(tx).changeQuantityInTransaction(input));
  }

  public async changeQuantityInTransaction(input: ChangeExternalParticipantQuantityInput): Promise<ExternalParticipantMutationResult> {
    validateQuantity(input.quantity);
    if (input.quantity > 0) return this.addQuantityInTransaction(input);
    const match = await new MatchesRepository(this.db).getForUpdate(input.matchId);
    const creatorId = ownerId(input.ownerTelegramUserId);
    if (creatorId !== match.creatorTelegramUserId) {
      throw new ForbiddenRepositoryError("Only the configured match owner can manage external participants");
    }
    if (!editable(match)) throw new RepositoryConflictError(`Match ${match.id.toString(10)} is not editable`, { details: { status: match.status } });
    const countsBefore = await new VotesRepository(this.db).rosterCounts(match.id);
    const source = normalizedDisplayName(input.sourceDisplayName ?? input.displayName);
    const rows = await this.db
      .select()
      .from(externalParticipants)
      .where(and(
        eq(externalParticipants.matchId, match.id),
        eq(externalParticipants.createdByTelegramUserId, creatorId),
        source === null ? isNull(externalParticipants.displayName) : eq(externalParticipants.displayName, source),
      ))
      .orderBy(desc(externalParticipants.id))
      .for("update");
    let remaining = Math.abs(input.quantity);
    let removedEntry: ExternalParticipant | undefined;
    for (const row of rows) {
      if (remaining === 0) break;
      if (row.quantity <= remaining) {
        const deleted = await this.db.delete(externalParticipants).where(eq(externalParticipants.id, row.id)).returning();
        if (deleted[0] !== undefined) removedEntry = deleted[0];
        remaining -= row.quantity;
      } else {
        const updated = await this.db
          .update(externalParticipants)
          .set({ quantity: sql`${externalParticipants.quantity} - ${remaining}`, updatedAt: effectiveNow(input.createdAt) })
          .where(eq(externalParticipants.id, row.id))
          .returning();
        if (updated[0] !== undefined) {
          removedEntry = row;
          remaining = 0;
        }
      }
    }
    if (remaining > 0) throw new RepositoryConflictError("Cannot remove more external participants than the source contains");
    const countsAfter = await new VotesRepository(this.db).rosterCounts(match.id);
    return mutationResult("removed", match, undefined, countsBefore, countsAfter, removedEntry);
  }

  public async remove(input: RemoveExternalParticipantInput): Promise<ExternalParticipantMutationResult> {
    return this.db.transaction(async (tx) => new ExternalParticipantsRepository(tx).removeInTransaction(input));
  }

  public async update(input: UpdateExternalParticipantInput): Promise<ExternalParticipantMutationResult> {
    return this.db.transaction(async (tx) => new ExternalParticipantsRepository(tx).updateInTransaction(input));
  }

  public async updateInTransaction(input: UpdateExternalParticipantInput): Promise<ExternalParticipantMutationResult> {
    if (input.displayName === undefined && input.availableAfter === undefined && input.quantity === undefined) {
      throw new ValidationRepositoryError("At least one external participant field must be updated");
    }
    if (input.quantity !== undefined) {
      validateQuantity(input.quantity);
      if (input.quantity !== 1) {
        throw new ValidationRepositoryError("An external participant row must represent exactly one person");
      }
    }
    const row = await this.findByIdForUpdate(input.id);
    if (row === undefined) throw new NotFoundRepositoryError(`External participant ${String(input.id)} was not found`);
    const match = await new MatchesRepository(this.db).getForUpdate(row.matchId);
    if (ownerId(input.ownerTelegramUserId) !== match.creatorTelegramUserId) {
      throw new ForbiddenRepositoryError("Only the configured match owner can manage external participants");
    }
    if (!editable(match)) throw new RepositoryConflictError(`Match ${match.id.toString(10)} is not editable`, { details: { status: match.status } });
    const countsBefore = await new VotesRepository(this.db).rosterCounts(match.id);
    const availableAfter = input.availableAfter === undefined
      ? undefined
      : normalizedAvailableAfter(match, input.availableAfter);
    const rows = await this.db
      .update(externalParticipants)
      .set({
        ...(input.displayName === undefined ? {} : { displayName: normalizedDisplayName(input.displayName) }),
        ...(availableAfter === undefined ? {} : { availableAfter }),
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
        updatedAt: effectiveNow(input.now),
      })
      .where(eq(externalParticipants.id, row.id))
      .returning();
    const entry = rows[0];
    if (entry === undefined) throw new RepositoryConflictError("External participant entry was updated concurrently");
    const countsAfter = await new VotesRepository(this.db).rosterCounts(match.id);
    return mutationResult("updated", match, entry, countsBefore, countsAfter);
  }

  /** Removes availability choices when a time poll becomes a fixed-time match. */
  public async clearTimeSelections(
    matchId: DatabaseIdentifier,
    now?: Date,
  ): Promise<ExternalParticipant[]> {
    return this.db
      .update(externalParticipants)
      .set({ availableAfter: null, updatedAt: effectiveNow(now) })
      .where(eq(externalParticipants.matchId, matchIdValue(matchId)))
      .returning();
  }

  public async removeInTransaction(input: RemoveExternalParticipantInput): Promise<ExternalParticipantMutationResult> {
    const row = await this.findByIdForUpdate(input.id);
    if (row === undefined) throw new NotFoundRepositoryError(`External participant ${String(input.id)} was not found`);
    const match = await new MatchesRepository(this.db).getForUpdate(row.matchId);
    if (ownerId(input.ownerTelegramUserId) !== match.creatorTelegramUserId) {
      throw new ForbiddenRepositoryError("Only the configured match owner can manage external participants");
    }
    if (!editable(match)) throw new RepositoryConflictError(`Match ${match.id.toString(10)} is not editable`, { details: { status: match.status } });
    const countsBefore = await new VotesRepository(this.db).rosterCounts(match.id);
    const deleted = await this.db.delete(externalParticipants).where(eq(externalParticipants.id, row.id)).returning();
    const removedEntry = deleted[0];
    if (removedEntry === undefined) throw new RepositoryConflictError("External participant entry was removed concurrently");
    const countsAfter = await new VotesRepository(this.db).rosterCounts(match.id);
    return mutationResult("removed", match, undefined, countsBefore, countsAfter, removedEntry);
  }

  public async updateDisplayNameByTelegramUserId(telegramUserId: DatabaseIdentifier, displayName: string): Promise<bigint[]> {
    const normalized = normalizedDisplayName(displayName);
    if (normalized === null) throw new ValidationRepositoryError("displayName must not be empty");
    const rows = await this.db
      .update(externalParticipants)
      .set({ displayName: normalized, updatedAt: effectiveNow() })
      .where(and(eq(externalParticipants.createdByTelegramUserId, ownerId(telegramUserId)), isNull(externalParticipants.displayName)))
      .returning({ matchId: externalParticipants.matchId });
    return [...new Set(rows.map((row) => row.matchId))];
  }

  private async findByIdForUpdate(id: DatabaseIdentifier): Promise<ExternalParticipant | undefined> {
    const rows = await this.db.select().from(externalParticipants).where(eq(externalParticipants.id, participantId(id))).limit(1).for("update");
    return rows[0];
  }

  private async totalForSource(matchId: DatabaseIdentifier, displayName: string | null): Promise<number> {
    const rows = await this.db
      .select({ total: sql<unknown>`coalesce(sum(${externalParticipants.quantity}), 0)` })
      .from(externalParticipants)
      .where(and(
        eq(externalParticipants.matchId, matchIdValue(matchId)),
        displayName === null ? isNull(externalParticipants.displayName) : eq(externalParticipants.displayName, displayName),
      ));
    return parseTotal(rows[0]?.total ?? 0);
  }
}

function matchIdValue(value: DatabaseIdentifier): bigint {
  return matchId(value);
}

function parseTotal(value: unknown): number {
  const parsed = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ValidationRepositoryError("External participant total is unsafe");
  return parsed;
}

function mutationResult(
  status: "added" | "updated" | "removed",
  match: Match,
  entry: ExternalParticipant | undefined,
  countsBefore: RosterCounts,
  countsAfter: RosterCounts,
  removedEntry?: ExternalParticipant,
): ExternalParticipantMutationResult {
  return {
    status,
    match,
    ...(entry === undefined ? {} : { entry }),
    ...(removedEntry === undefined ? {} : { removedEntry }),
    countsBefore,
    countsAfter,
    thresholdReached: !countsBefore.thresholdReached && countsAfter.thresholdReached,
    thresholdLost: countsBefore.thresholdReached && !countsAfter.thresholdReached,
  };
}

export function createExternalParticipantsRepository(db: AppDatabase): ExternalParticipantsRepository {
  return new ExternalParticipantsRepository(db);
}
