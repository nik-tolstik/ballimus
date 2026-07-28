import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  externalParticipants,
  matches,
  processedUpdates,
  votes,
  type Match,
  type MatchStatus,
  type VenueType,
  type Vote,
  type VoteOption,
} from "../schema.js";

export interface ApplyVoteInput {
  updateId: number;
  matchId: number;
  telegramUserId: number;
  usernameSnapshot: string | null;
  displayNameSnapshot: string;
  option: VoteOption;
}

export type ApplyVoteResult =
  | { status: "duplicate"; processedMatchId: number }
  | { status: "missing_match" }
  | { status: "inactive_match"; match: Match }
  | {
      status: "applied";
      match: Match;
      previousVote: Vote | undefined;
      goingCountBefore: number;
      goingCountAfter: number;
      externalCount: number;
    };

export interface ChangeMatchStatusInput {
  updateId: number;
  matchId: number;
  telegramUserId: number;
  status: Extract<MatchStatus, "confirmed" | "completed" | "cancelled">;
  cancellationReason?: string | null;
  allowedCurrentStatuses: readonly MatchStatus[];
}

export type ChangeMatchStatusResult =
  | { status: "duplicate"; processedMatchId: number }
  | { status: "missing_match" }
  | { status: "inactive_match"; match: Match }
  | { status: "changed"; match: Match };

export interface UpdateMatchDetailsInput {
  updateId: number;
  matchId: number;
  telegramUserId: number;
  scheduledAt: Date | null;
  location: string | null;
  venueType: VenueType | null;
  fieldPriceRubles: number | null;
  title: string;
  requiredPlayers: number;
  allowedCurrentStatuses: readonly MatchStatus[];
}

export type UpdateMatchDetailsResult =
  | { status: "duplicate"; processedMatchId: number }
  | { status: "missing_match" }
  | { status: "inactive_match"; match: Match }
  | { status: "updated"; match: Match };

function countGoing(tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0], matchId: number): number {
  return tx
    .select()
    .from(votes)
    .where(and(eq(votes.matchId, matchId), eq(votes.option, "going")))
    .all().length;
}

function countExternal(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  matchId: number,
): number {
  return tx
    .select()
    .from(externalParticipants)
    .where(eq(externalParticipants.matchId, matchId))
    .all()
    .reduce((total, item) => total + item.quantity, 0);
}

export class MatchActionsRepository {
  public constructor(private readonly db: AppDatabase) {}

  public applyVote(input: ApplyVoteInput): ApplyVoteResult {
    return this.db.transaction((tx) => {
      const processed = tx
        .select()
        .from(processedUpdates)
        .where(eq(processedUpdates.updateId, input.updateId))
        .get();
      if (processed !== undefined) {
        return { status: "duplicate", processedMatchId: processed.matchId };
      }

      const match = tx.select().from(matches).where(eq(matches.id, input.matchId)).get();
      if (match === undefined) return { status: "missing_match" };
      if (match.status !== "active" && match.status !== "confirmed") {
        return { status: "inactive_match", match };
      }

      const previousVote = tx
        .select()
        .from(votes)
        .where(
          and(eq(votes.matchId, input.matchId), eq(votes.telegramUserId, input.telegramUserId)),
        )
        .get();
      const externalCount = countExternal(tx, input.matchId);
      const goingCountBefore = countGoing(tx, input.matchId) + externalCount;

      tx.insert(votes)
        .values({
          matchId: input.matchId,
          telegramUserId: input.telegramUserId,
          usernameSnapshot: input.usernameSnapshot,
          displayNameSnapshot: input.displayNameSnapshot,
          option: input.option,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [votes.matchId, votes.telegramUserId],
          set: {
            usernameSnapshot: input.usernameSnapshot,
            displayNameSnapshot: input.displayNameSnapshot,
            option: input.option,
            updatedAt: new Date(),
          },
        })
        .run();

      const goingCountAfter = countGoing(tx, input.matchId) + externalCount;
      tx.insert(processedUpdates)
        .values({
          updateId: input.updateId,
          matchId: input.matchId,
          action: `vote:${input.option}`,
          telegramUserId: input.telegramUserId,
          createdAt: new Date(),
        })
        .run();

      return {
        status: "applied",
        match,
        previousVote,
        goingCountBefore,
        goingCountAfter,
        externalCount,
      };
    });
  }

  public changeStatus(input: ChangeMatchStatusInput): ChangeMatchStatusResult {
    return this.db.transaction((tx) => {
      const processed = tx
        .select()
        .from(processedUpdates)
        .where(eq(processedUpdates.updateId, input.updateId))
        .get();
      if (processed !== undefined) {
        return { status: "duplicate", processedMatchId: processed.matchId };
      }

      const current = tx.select().from(matches).where(eq(matches.id, input.matchId)).get();
      if (current === undefined) return { status: "missing_match" };
      if (!input.allowedCurrentStatuses.includes(current.status)) {
        return { status: "inactive_match", match: current };
      }

      const match = tx
        .update(matches)
        .set({
          status: input.status,
          ...(input.cancellationReason === undefined
            ? {}
            : { cancellationReason: input.cancellationReason }),
          updatedAt: new Date(),
        })
        .where(eq(matches.id, input.matchId))
        .returning()
        .get();
      if (match === undefined) return { status: "missing_match" };

      tx.insert(processedUpdates)
        .values({
          updateId: input.updateId,
          matchId: input.matchId,
          action: `match:${input.status}`,
          telegramUserId: input.telegramUserId,
          createdAt: new Date(),
        })
        .run();

      return { status: "changed", match };
    });
  }

  public updateDetails(input: UpdateMatchDetailsInput): UpdateMatchDetailsResult {
    return this.db.transaction((tx) => {
      const processed = tx
        .select()
        .from(processedUpdates)
        .where(eq(processedUpdates.updateId, input.updateId))
        .get();
      if (processed !== undefined) {
        return { status: "duplicate", processedMatchId: processed.matchId };
      }

      const current = tx.select().from(matches).where(eq(matches.id, input.matchId)).get();
      if (current === undefined) return { status: "missing_match" };
      if (!input.allowedCurrentStatuses.includes(current.status)) {
        return { status: "inactive_match", match: current };
      }

      const match = tx
        .update(matches)
        .set({
          scheduledAt: input.scheduledAt,
          location: input.location,
          venueType: input.venueType,
          fieldPriceRubles: input.fieldPriceRubles,
          title: input.title,
          requiredPlayers: input.requiredPlayers,
          updatedAt: new Date(),
        })
        .where(eq(matches.id, input.matchId))
        .returning()
        .get();
      if (match === undefined) return { status: "missing_match" };

      tx.insert(processedUpdates)
        .values({
          updateId: input.updateId,
          matchId: input.matchId,
          action: "match:edit",
          telegramUserId: input.telegramUserId,
          createdAt: new Date(),
        })
        .run();

      return { status: "updated", match };
    });
  }
}

export function createMatchActionsRepository(db: AppDatabase): MatchActionsRepository {
  return new MatchActionsRepository(db);
}
