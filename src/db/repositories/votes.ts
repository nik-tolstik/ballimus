import { and, asc, eq, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import { votes, type Vote, type VoteOption } from "../schema.js";
import { normalizeTelegramUsername } from "./user-aliases.js";

function usernameCondition(username: string) {
  return sql`lower(ltrim(trim(${votes.usernameSnapshot}), '@')) = ${normalizeTelegramUsername(username)}`;
}

export interface UpsertVoteInput {
  matchId: number;
  telegramUserId: number;
  usernameSnapshot?: string | null;
  displayNameSnapshot: string;
  option: VoteOption;
  updatedAt?: Date;
}

export class VotesRepository {
  public constructor(private readonly db: AppDatabase) {}

  public find(matchId: number, telegramUserId: number): Vote | undefined {
    return this.db
      .select()
      .from(votes)
      .where(and(eq(votes.matchId, matchId), eq(votes.telegramUserId, telegramUserId)))
      .get();
  }

  public findByUser(matchId: number, telegramUserId: number): Vote | undefined {
    return this.find(matchId, telegramUserId);
  }

  public listByMatchId(matchId: number): Vote[] {
    return this.db
      .select()
      .from(votes)
      .where(eq(votes.matchId, matchId))
      .orderBy(asc(votes.telegramUserId))
      .all();
  }

  public findTelegramUserIdsByUsername(username: string): number[] {
    const rows = this.db
      .select({ telegramUserId: votes.telegramUserId })
      .from(votes)
      .where(usernameCondition(username))
      .all();

    return [...new Set(rows.map((row) => row.telegramUserId))];
  }

  public renameUser(input: {
    username: string;
    displayName: string;
    telegramUserId?: number | null;
  }): number[] {
    const conditions = [usernameCondition(input.username)];
    if (input.telegramUserId !== undefined && input.telegramUserId !== null) {
      conditions.push(eq(votes.telegramUserId, input.telegramUserId));
    }

    const affectedRows = this.db
      .select({ matchId: votes.matchId })
      .from(votes)
      .where(or(...conditions))
      .all();

    this.db
      .update(votes)
      .set({ displayNameSnapshot: input.displayName })
      .where(or(...conditions))
      .run();

    return [...new Set(affectedRows.map((row) => row.matchId))];
  }

  public upsert(input: UpsertVoteInput): Vote {
    const updatedAt = input.updatedAt ?? new Date();
    const record = this.db
      .insert(votes)
      .values({
        matchId: input.matchId,
        telegramUserId: input.telegramUserId,
        usernameSnapshot: input.usernameSnapshot ?? null,
        displayNameSnapshot: input.displayNameSnapshot,
        option: input.option,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [votes.matchId, votes.telegramUserId],
        set: {
          usernameSnapshot: input.usernameSnapshot ?? null,
          displayNameSnapshot: input.displayNameSnapshot,
          option: input.option,
          updatedAt,
        },
      })
      .returning()
      .get();

    if (!record) {
      throw new Error("Vote was not upserted");
    }

    return record;
  }

  public setVote(input: UpsertVoteInput): Vote {
    return this.upsert(input);
  }

  public delete(matchId: number, telegramUserId: number): boolean {
    return (
      this.db
        .delete(votes)
        .where(and(eq(votes.matchId, matchId), eq(votes.telegramUserId, telegramUserId)))
        .run().changes > 0
    );
  }

  public deleteForMatch(matchId: number): number {
    return this.db.delete(votes).where(eq(votes.matchId, matchId)).run().changes;
  }

  public countByOption(matchId: number, option: VoteOption): number {
    const result = this.db
      .select({ count: sql<number>`count(*)` })
      .from(votes)
      .where(and(eq(votes.matchId, matchId), eq(votes.option, option)))
      .get();

    return result?.count ?? 0;
  }

  public countGoing(matchId: number): number {
    return this.countByOption(matchId, "going");
  }
}

export function createVotesRepository(db: AppDatabase): VotesRepository {
  return new VotesRepository(db);
}
