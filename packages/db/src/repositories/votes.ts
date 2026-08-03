import { and, asc, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  externalParticipants,
  matches,
  votes,
  type Match,
  type Vote,
  type VoteOption,
  type VoteSource,
} from "../schema.js";
import { normalizeTelegramUsername } from "../serialization.js";
import {
  effectiveNow,
  nonEmpty,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
  toBigInt,
} from "./common.js";
import {
  ForbiddenRepositoryError,
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";
import { MatchesRepository } from "./matches.js";
import { PlayersRepository, type TelegramIdentityInput } from "./players.js";
import { TelegramUpdatesRepository } from "./telegram-updates.js";

export interface UpsertVoteInput {
  readonly matchId: DatabaseIdentifier;
  readonly playerId?: DatabaseIdentifier;
  readonly telegramUserId: DatabaseIdentifier;
  readonly usernameSnapshot?: string | null;
  readonly firstNameSnapshot?: string | null;
  readonly lastNameSnapshot?: string | null;
  readonly displayNameSnapshot: string;
  readonly option: VoteOption;
  readonly availableAfter?: string | null;
  readonly exactTimes?: readonly string[];
  readonly source?: VoteSource;
  readonly telegramUpdateId?: DatabaseIdentifier | null;
  readonly updatedAt?: Date;
}

export interface TelegramVoteInput {
  readonly updateId: DatabaseIdentifier;
  readonly matchId: DatabaseIdentifier;
  readonly identity: TelegramIdentityInput;
  readonly option: VoteOption;
  readonly availableAfter?: string | null;
  readonly exactTimes?: readonly string[];
}

export interface OwnerVoteInput {
  readonly matchId: DatabaseIdentifier;
  readonly ownerTelegramUserId: DatabaseIdentifier;
  readonly playerId?: DatabaseIdentifier;
  readonly telegramUserId?: DatabaseIdentifier;
  readonly option: VoteOption;
  readonly availableAfter?: string | null;
  readonly exactTimes?: readonly string[];
  readonly displayNameSnapshot?: string;
  readonly updatedAt?: Date;
}

export interface RemoveOwnerVoteInput {
  readonly matchId: DatabaseIdentifier;
  readonly ownerTelegramUserId: DatabaseIdentifier;
  readonly playerId?: DatabaseIdentifier;
  readonly telegramUserId?: DatabaseIdentifier;
  readonly updatedAt?: Date;
}

export interface RosterCounts {
  readonly goingVotes: number;
  readonly externalParticipants: number;
  readonly goingCount: number;
  readonly requiredPlayers: number;
  readonly thresholdReached: boolean;
  readonly remainingToThreshold: number;
}

export interface VoteMutationResult {
  readonly status: "applied" | "removed";
  readonly match: Match;
  readonly playerId: bigint;
  readonly vote?: Vote;
  readonly previousVote?: Vote;
  readonly removedVote?: Vote;
  readonly countsBefore: RosterCounts;
  readonly countsAfter: RosterCounts;
  readonly thresholdReached: boolean;
  readonly thresholdLost: boolean;
}

export type TelegramVoteResult =
  | VoteMutationResult
  | { readonly status: "duplicate"; readonly updateId: bigint }
  | { readonly status: "inactive"; readonly match: Match; readonly updateId: bigint };

function parsedMatchId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "matchId");
}

function parsedPlayerId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "playerId");
}

function parsedTelegramUserId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "telegramUserId");
}

function validOption(value: VoteOption): void {
  if (value !== "going" && value !== "not_going" && value !== "maybe") {
    throw new ValidationRepositoryError("option must be going, not_going, or maybe");
  }
}

function snapshot(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.normalize("NFC").trim();
  return normalized === "" ? null : normalized;
}

function safeCount(value: unknown, fieldName: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } else if (typeof value === "bigint") {
    const converted = Number(value);
    if (Number.isSafeInteger(converted) && converted >= 0) return converted;
  } else if (typeof value === "string") {
    const converted = Number(value);
    if (Number.isSafeInteger(converted) && converted >= 0) return converted;
  }
  throw new ValidationRepositoryError(`${fieldName} returned an unsafe database count`);
}

function editableMatch(match: Match): boolean {
  return match.status === "active" || match.status === "confirmed";
}

function normalizedTimeSelection(
  match: Match,
  option: VoteOption,
  availableAfterInput: string | null | undefined,
  exactTimesInput: readonly string[] | undefined,
): { readonly availableAfter: string | null; readonly exactTimes: string[] } {
  if (option !== "going") {
    if ((availableAfterInput !== undefined && availableAfterInput !== null) || (exactTimesInput?.length ?? 0) > 0) {
      throw new ValidationRepositoryError("time selections are only valid for going votes");
    }
    return { availableAfter: null, exactTimes: [] };
  }
  if (match.timeMode === "exact") {
    if ((availableAfterInput !== undefined && availableAfterInput !== null) || (exactTimesInput?.length ?? 0) > 0) {
      throw new ValidationRepositoryError("fixed exact matches do not accept time selections");
    }
    return { availableAfter: null, exactTimes: [] };
  }
  if (match.timeMode === "availability") {
    if (availableAfterInput === undefined || availableAfterInput === null || !match.timeOptions.includes(availableAfterInput)) {
      throw new ValidationRepositoryError("availableAfter must be one of the match time options");
    }
    if ((exactTimesInput?.length ?? 0) > 0) {
      throw new ValidationRepositoryError("availability votes do not accept exactTimes");
    }
    return { availableAfter: availableAfterInput, exactTimes: [] };
  }
  const exactTimes = [...new Set(exactTimesInput ?? (availableAfterInput === undefined || availableAfterInput === null ? [] : [availableAfterInput]))].sort();
  if (exactTimes.length === 0 || exactTimes.some((time) => !match.timeOptions.includes(time))) {
    throw new ValidationRepositoryError("exactTimes must contain one or more match time options");
  }
  if (availableAfterInput !== undefined && availableAfterInput !== null && exactTimesInput !== undefined) {
    throw new ValidationRepositoryError("availableAfter and exactTimes cannot be supplied together");
  }
  return { availableAfter: null, exactTimes };
}

/** Current votes and transaction-safe Telegram/owner mutations. */
export class VotesRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async find(matchId: DatabaseIdentifier, telegramUserId: DatabaseIdentifier): Promise<Vote | undefined> {
    const rows = await this.db
      .select()
      .from(votes)
      .where(and(eq(votes.matchId, parsedMatchId(matchId)), eq(votes.telegramUserId, parsedTelegramUserId(telegramUserId))))
      .limit(1);
    return rows[0];
  }

  public async findByUser(matchId: DatabaseIdentifier, telegramUserId: DatabaseIdentifier): Promise<Vote | undefined> {
    return this.find(matchId, telegramUserId);
  }

  public async findByPlayerId(matchId: DatabaseIdentifier, playerId: DatabaseIdentifier): Promise<Vote | undefined> {
    const rows = await this.db
      .select()
      .from(votes)
      .where(and(eq(votes.matchId, parsedMatchId(matchId)), eq(votes.playerId, parsedPlayerId(playerId))))
      .limit(1);
    return rows[0];
  }

  public async listByMatchId(matchId: DatabaseIdentifier): Promise<Vote[]> {
    return this.db
      .select()
      .from(votes)
      .where(eq(votes.matchId, parsedMatchId(matchId)))
      .orderBy(asc(votes.telegramUserId));
  }

  public async findByMatchIdAndUsername(matchId: DatabaseIdentifier, username: string): Promise<Vote[]> {
    const normalized = normalizeTelegramUsername(username);
    if (normalized === "") throw new ValidationRepositoryError("username must not be empty");
    return this.db
      .select()
      .from(votes)
      .where(and(
        eq(votes.matchId, parsedMatchId(matchId)),
        sql`lower(ltrim(trim(${votes.usernameSnapshot}), '@')) = ${normalized}`,
      ))
      .orderBy(asc(votes.telegramUserId));
  }

  public async findTelegramUserIdsByUsername(username: string): Promise<bigint[]> {
    const normalized = normalizeTelegramUsername(username);
    const rows = await this.db
      .select({ telegramUserId: votes.telegramUserId })
      .from(votes)
      .where(sql`lower(ltrim(trim(${votes.usernameSnapshot}), '@')) = ${normalized}`)
      .orderBy(asc(votes.telegramUserId));
    return [...new Set(rows.map((row) => row.telegramUserId))];
  }

  public async countByOption(matchId: DatabaseIdentifier, option: VoteOption): Promise<number> {
    validOption(option);
    const rows = await this.db
      .select({ count: sql<unknown>`count(*)` })
      .from(votes)
      .where(and(eq(votes.matchId, parsedMatchId(matchId)), eq(votes.option, option)));
    return safeCount(rows[0]?.count ?? 0, "vote count");
  }

  public async countGoing(matchId: DatabaseIdentifier): Promise<number> {
    return this.countByOption(matchId, "going");
  }

  /** Keeps going votes while removing poll-specific choices after a move to one fixed time. */
  public async clearGoingTimeSelections(
    matchId: DatabaseIdentifier,
    updatedAt?: Date,
  ): Promise<Vote[]> {
    return this.db
      .update(votes)
      .set({
        availableAfter: null,
        exactTimes: [],
        updatedAt: effectiveNow(updatedAt),
      })
      .where(and(
        eq(votes.matchId, parsedMatchId(matchId)),
        eq(votes.option, "going"),
      ))
      .returning();
  }

  public async rosterCounts(matchId: DatabaseIdentifier): Promise<RosterCounts> {
    const parsedId = parsedMatchId(matchId);
    const matchRows = await this.db.select({
      requiredPlayers: matches.requiredPlayers,
      timeMode: matches.timeMode,
      timeOptions: matches.timeOptions,
      selectedTime: matches.selectedTime,
    }).from(matches).where(eq(matches.id, parsedId)).limit(1);
    const match = matchRows[0];
    if (match === undefined) throw new NotFoundRepositoryError(`Match ${parsedId} was not found`);
    const requiredPlayers = match.requiredPlayers;
    const exactOptionRows = match.timeMode === "exact_options" && match.selectedTime === null
      ? await this.db
        .select({ exactTimes: votes.exactTimes })
        .from(votes)
        .where(and(eq(votes.matchId, parsedId), eq(votes.option, "going")))
      : [];
    const voteCount = match.timeMode === "exact_options" && match.selectedTime === null
      ? Math.max(0, ...match.timeOptions.map(
        (time) => exactOptionRows.filter((row) => row.exactTimes.includes(time)).length,
      ))
      : safeCount((await this.db
        .select({ count: sql<unknown>`count(*)` })
        .from(votes)
        .where(and(
          eq(votes.matchId, parsedId),
          eq(votes.option, "going"),
          ...(match.timeMode === "availability" && match.selectedTime !== null
            ? [sql`(${votes.availableAfter} is null or ${votes.availableAfter} <= ${match.selectedTime})`]
            : match.timeMode === "exact_options" && match.selectedTime !== null
              ? [sql`${votes.exactTimes} ? ${match.selectedTime}`]
              : []),
        )))[0]?.count ?? 0, "eligible vote count");
    const externalRows = await this.db
      .select({ quantity: externalParticipants.quantity })
      .from(externalParticipants)
      .where(and(
        eq(externalParticipants.matchId, parsedId),
        ...(match.timeMode === "availability" && match.selectedTime !== null
          ? [sql`${externalParticipants.availableAfter} is not null and ${externalParticipants.availableAfter} <= ${match.selectedTime}`]
          : []),
      ));
    const externalCount = externalRows.reduce((total, row) => total + row.quantity, 0);
    const goingCount = voteCount + externalCount;
    return {
      goingVotes: voteCount,
      externalParticipants: externalCount,
      goingCount,
      requiredPlayers,
      thresholdReached: goingCount >= requiredPlayers,
      remainingToThreshold: Math.max(0, requiredPlayers - goingCount),
    };
  }

  public async upsert(input: UpsertVoteInput): Promise<Vote> {
    return this.db.transaction(async (tx) => new VotesRepository(tx).upsertInTransaction(input));
  }

  public async upsertInTransaction(input: UpsertVoteInput): Promise<Vote> {
    const matchId = parsedMatchId(input.matchId);
    const telegramUserId = parsedTelegramUserId(input.telegramUserId);
    validOption(input.option);
    const match = await new MatchesRepository(this.db).getById(matchId);
    const timeSelection = normalizedTimeSelection(match, input.option, input.availableAfter, input.exactTimes);
    const source = input.source ?? "owner_correction";
    if (source === "telegram_callback" && input.telegramUpdateId === undefined) {
      throw new ValidationRepositoryError("telegramUpdateId is required for Telegram votes");
    }
    if (source === "owner_correction" && input.telegramUpdateId !== undefined && input.telegramUpdateId !== null) {
      throw new ValidationRepositoryError("owner corrections cannot reference Telegram updates");
    }
    const player = input.playerId === undefined
      ? await new PlayersRepository(this.db).findByTelegramUserId(telegramUserId)
      : await new PlayersRepository(this.db).findById(input.playerId);
    if (player === undefined) throw new NotFoundRepositoryError("The Telegram player is not known");
    if (player.telegramUserId !== telegramUserId) {
      throw new RepositoryConflictError("The vote Telegram identity does not match the player", {
        details: { playerId: player.id, telegramUserId: player.telegramUserId },
      });
    }
    const displayName = nonEmpty(input.displayNameSnapshot, "displayNameSnapshot", 200);
    const now = effectiveNow(input.updatedAt);
    const updateId = input.telegramUpdateId === undefined || input.telegramUpdateId === null
      ? null
      : toBigInt(input.telegramUpdateId, "telegramUpdateId");
    const rows = await this.db
      .insert(votes)
      .values({
        matchId,
        playerId: player.id,
        telegramUserId,
        usernameSnapshot: snapshot(input.usernameSnapshot),
        firstNameSnapshot: snapshot(input.firstNameSnapshot),
        lastNameSnapshot: snapshot(input.lastNameSnapshot),
        displayNameSnapshot: displayName,
        option: input.option,
        availableAfter: timeSelection.availableAfter,
        exactTimes: timeSelection.exactTimes,
        source,
        telegramUpdateId: updateId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [votes.matchId, votes.playerId],
        set: {
          telegramUserId,
          usernameSnapshot: snapshot(input.usernameSnapshot),
          firstNameSnapshot: snapshot(input.firstNameSnapshot),
          lastNameSnapshot: snapshot(input.lastNameSnapshot),
          displayNameSnapshot: displayName,
          option: input.option,
          availableAfter: timeSelection.availableAfter,
          exactTimes: timeSelection.exactTimes,
          source,
          telegramUpdateId: updateId,
          updatedAt: now,
        },
      })
      .returning();
    const vote = rows[0];
    if (vote === undefined) throw new NotFoundRepositoryError("Vote was not persisted");
    return vote;
  }

  /** Claims the update, binds the player, writes one current vote, and marks the update processed atomically. */
  public async applyTelegramVote(input: TelegramVoteInput): Promise<TelegramVoteResult> {
    return this.db.transaction(async (tx) => new VotesRepository(tx).applyTelegramVoteInTransaction(input));
  }

  public async applyTelegramVoteInTransaction(input: TelegramVoteInput): Promise<TelegramVoteResult> {
    validOption(input.option);
    const updateId = toBigInt(input.updateId, "updateId");
    const claim = await new TelegramUpdatesRepository(this.db).claimInTransaction(updateId, input.identity.seenAt);
    if (claim.status === "duplicate") return { status: "duplicate", updateId };
    const matchRepository = new MatchesRepository(this.db);
    const match = await matchRepository.findForUpdate(input.matchId);
    if (match === undefined) {
      await new TelegramUpdatesRepository(this.db).markProcessedInTransaction(updateId);
      throw new NotFoundRepositoryError(`Match ${String(input.matchId)} was not found`);
    }
    if (!editableMatch(match)) {
      await new TelegramUpdatesRepository(this.db).markProcessedInTransaction(updateId);
      return { status: "inactive", match, updateId };
    }
    const binding = await new PlayersRepository(this.db).bindTelegramUserInTransaction(input.identity);
    const previousVote = await this.findByPlayerId(match.id, binding.player.id);
    const countsBefore = await this.rosterCounts(match.id);
    const identity = input.identity;
    const toggledExactTime = match.timeMode === "exact_options"
      && input.option === "going"
      && input.availableAfter !== undefined
      && input.availableAfter !== null
      && input.exactTimes === undefined
      ? input.availableAfter
      : undefined;
    const exactTimes = toggledExactTime === undefined
      ? input.exactTimes
      : (() => {
        if (!match.timeOptions.includes(toggledExactTime)) {
          throw new ValidationRepositoryError("exact time must be one of the match time options");
        }
        const current = previousVote?.option === "going"
          ? previousVote.exactTimes
          : [];
        return current.includes(toggledExactTime)
          ? current.filter((time) => time !== toggledExactTime)
          : [...current, toggledExactTime].sort();
      })();
    if (toggledExactTime !== undefined && exactTimes?.length === 0) {
      const removedRows = await this.db
        .delete(votes)
        .where(and(eq(votes.matchId, match.id), eq(votes.playerId, binding.player.id)))
        .returning();
      const removedVote = removedRows[0];
      if (removedVote === undefined || previousVote === undefined) {
        throw new NotFoundRepositoryError("The exact-time vote was removed concurrently");
      }
      const countsAfter = await this.rosterCounts(match.id);
      await new TelegramUpdatesRepository(this.db).markProcessedInTransaction(updateId);
      return {
        status: "removed",
        match,
        playerId: binding.player.id,
        removedVote,
        previousVote,
        countsBefore,
        countsAfter,
        thresholdReached: !countsBefore.thresholdReached && countsAfter.thresholdReached,
        thresholdLost: countsBefore.thresholdReached && !countsAfter.thresholdReached,
      };
    }
    const vote = await this.upsertInTransaction({
      matchId: match.id,
      playerId: binding.player.id,
      telegramUserId: identity.telegramUserId,
      usernameSnapshot: identity.username ?? null,
      firstNameSnapshot: identity.firstName ?? null,
      lastNameSnapshot: identity.lastName ?? null,
      displayNameSnapshot: binding.player.displayName ?? identity.displayName ?? `Telegram user ${String(identity.telegramUserId)}`,
      option: input.option,
      ...(toggledExactTime === undefined && input.availableAfter !== undefined ? { availableAfter: input.availableAfter } : {}),
      ...(exactTimes === undefined ? {} : { exactTimes }),
      source: "telegram_callback",
      telegramUpdateId: updateId,
    });
    const countsAfter = await this.rosterCounts(match.id);
    await new TelegramUpdatesRepository(this.db).markProcessedInTransaction(updateId);
    return {
      status: "applied",
      match,
      playerId: binding.player.id,
      vote,
      ...(previousVote === undefined ? {} : { previousVote }),
      countsBefore,
      countsAfter,
      thresholdReached: !countsBefore.thresholdReached && countsAfter.thresholdReached,
      thresholdLost: countsBefore.thresholdReached && !countsAfter.thresholdReached,
    };
  }

  /** Owner correction uses only an already-bound player and cannot fabricate an identity from a username. */
  public async correctByOwner(input: OwnerVoteInput): Promise<VoteMutationResult> {
    return this.db.transaction(async (tx) => new VotesRepository(tx).correctByOwnerInTransaction(input));
  }

  public async correctByOwnerInTransaction(input: OwnerVoteInput): Promise<VoteMutationResult> {
    validOption(input.option);
    const match = await new MatchesRepository(this.db).getForUpdate(input.matchId);
    const ownerId = parsedTelegramUserId(input.ownerTelegramUserId);
    if (ownerId !== match.creatorTelegramUserId) {
      throw new ForbiddenRepositoryError("Only the configured match owner can correct votes");
    }
    const player = await this.resolveKnownPlayer(input.playerId, input.telegramUserId);
    const previousVote = await this.findByPlayerId(match.id, player.id);
    const countsBefore = await this.rosterCounts(match.id);
    const vote = await this.upsertInTransaction({
      matchId: match.id,
      playerId: player.id,
      telegramUserId: player.telegramUserId ?? 0n,
      displayNameSnapshot: input.displayNameSnapshot ?? player.displayName ?? "Игрок",
      option: input.option,
      ...(input.availableAfter === undefined ? {} : { availableAfter: input.availableAfter }),
      ...(input.exactTimes === undefined ? {} : { exactTimes: input.exactTimes }),
      source: "owner_correction",
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    });
    const countsAfter = await this.rosterCounts(match.id);
    return {
      status: "applied",
      match,
      playerId: player.id,
      vote,
      ...(previousVote === undefined ? {} : { previousVote }),
      countsBefore,
      countsAfter,
      thresholdReached: !countsBefore.thresholdReached && countsAfter.thresholdReached,
      thresholdLost: countsBefore.thresholdReached && !countsAfter.thresholdReached,
    };
  }

  public async removeByOwner(input: RemoveOwnerVoteInput): Promise<VoteMutationResult> {
    return this.db.transaction(async (tx) => new VotesRepository(tx).removeByOwnerInTransaction(input));
  }

  public async removeByOwnerInTransaction(input: RemoveOwnerVoteInput): Promise<VoteMutationResult> {
    const match = await new MatchesRepository(this.db).getForUpdate(input.matchId);
    const ownerId = parsedTelegramUserId(input.ownerTelegramUserId);
    if (ownerId !== match.creatorTelegramUserId) {
      throw new ForbiddenRepositoryError("Only the configured match owner can remove votes");
    }
    const player = await this.resolveKnownPlayer(input.playerId, input.telegramUserId);
    const previousVote = await this.findByPlayerId(match.id, player.id);
    if (previousVote === undefined) {
      throw new NotFoundRepositoryError("The player has no vote for this match");
    }
    const countsBefore = await this.rosterCounts(match.id);
    const rows = await this.db
      .delete(votes)
      .where(and(eq(votes.matchId, match.id), eq(votes.playerId, player.id)))
      .returning();
    const removedVote = rows[0];
    if (removedVote === undefined) throw new NotFoundRepositoryError("The vote was removed concurrently");
    const countsAfter = await this.rosterCounts(match.id);
    return {
      status: "removed",
      match,
      playerId: player.id,
      removedVote,
      previousVote,
      countsBefore,
      countsAfter,
      thresholdReached: !countsBefore.thresholdReached && countsAfter.thresholdReached,
      thresholdLost: countsBefore.thresholdReached && !countsAfter.thresholdReached,
    };
  }

  public async delete(matchId: DatabaseIdentifier, telegramUserId: DatabaseIdentifier): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const parsedId = parsedMatchId(matchId);
      const player = await new PlayersRepository(tx).findByTelegramUserId(telegramUserId);
      if (player === undefined) return false;
      const rows = await tx.delete(votes).where(and(eq(votes.matchId, parsedId), eq(votes.playerId, player.id))).returning({ matchId: votes.matchId });
      return rows.length > 0;
    });
  }

  private async resolveKnownPlayer(
    playerId: DatabaseIdentifier | undefined,
    telegramUserId: DatabaseIdentifier | undefined,
  ) {
    if (playerId === undefined && telegramUserId === undefined) {
      throw new ValidationRepositoryError("playerId or telegramUserId is required");
    }
    const repository = new PlayersRepository(this.db);
    const player = playerId === undefined
      ? await repository.findByTelegramUserId(telegramUserId as DatabaseIdentifier)
      : await repository.findById(playerId);
    if (player === undefined) throw new NotFoundRepositoryError("The player is not known");
    if (telegramUserId !== undefined && player.telegramUserId !== parsedTelegramUserId(telegramUserId)) {
      throw new RepositoryConflictError("The player and Telegram identity do not match");
    }
    if (player.telegramUserId === null) throw new RepositoryConflictError("An unconfirmed alias cannot have a vote");
    return player;
  }
}

export function createVotesRepository(db: AppDatabase): VotesRepository {
  return new VotesRepository(db);
}
