import { and, eq, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  externalParticipants,
  type ExternalParticipant,
} from "../schema.js";

export interface AddExternalParticipantInput {
  matchId: number;
  addedByTelegramUserId: number;
  sourceUpdateId: number;
  sourceLabel?: string | null;
  displayNameSnapshot?: string | null;
  quantity?: number;
  createdAt?: Date;
}

export class ExternalParticipantsRepository {
  public constructor(private readonly db: AppDatabase) {}

  public add(input: AddExternalParticipantInput): ExternalParticipant | undefined {
    return this.db
      .insert(externalParticipants)
      .values({
        matchId: input.matchId,
        addedByTelegramUserId: input.addedByTelegramUserId,
        sourceUpdateId: input.sourceUpdateId,
        sourceLabel: input.sourceLabel ?? null,
        displayNameSnapshot: input.displayNameSnapshot ?? null,
        quantity: input.quantity ?? 1,
        createdAt: input.createdAt ?? new Date(),
      })
      .onConflictDoNothing({ target: externalParticipants.sourceUpdateId })
      .returning()
      .get();
  }

  public countByMatchId(matchId: number): number {
    const result = this.db
      .select({ count: sql<number>`coalesce(sum(${externalParticipants.quantity}), 0)` })
      .from(externalParticipants)
      .where(eq(externalParticipants.matchId, matchId))
      .get();

    return result?.count ?? 0;
  }

  public countByMatchIdAndSourceLabel(matchId: number, sourceLabel: string): number {
    const result = this.db
      .select({ count: sql<number>`coalesce(sum(${externalParticipants.quantity}), 0)` })
      .from(externalParticipants)
      .where(
        and(
          eq(externalParticipants.matchId, matchId),
          eq(externalParticipants.sourceLabel, sourceLabel),
        ),
      )
      .get();

    return result?.count ?? 0;
  }

  public countByMatchIdWithoutSourceLabel(matchId: number): number {
    const result = this.db
      .select({ count: sql<number>`coalesce(sum(${externalParticipants.quantity}), 0)` })
      .from(externalParticipants)
      .where(
        and(
          eq(externalParticipants.matchId, matchId),
          isNull(externalParticipants.sourceLabel),
        ),
      )
      .get();

    return result?.count ?? 0;
  }

  public countByMatchIdAndAddedByTelegramUserId(matchId: number, telegramUserId: number): number {
    const result = this.db
      .select({ count: sql<number>`coalesce(sum(${externalParticipants.quantity}), 0)` })
      .from(externalParticipants)
      .where(
        and(
          eq(externalParticipants.matchId, matchId),
          eq(externalParticipants.addedByTelegramUserId, telegramUserId),
          isNull(externalParticipants.sourceLabel),
        ),
      )
      .get();

    return result?.count ?? 0;
  }

  public findBySourceUpdateId(sourceUpdateId: number): ExternalParticipant | undefined {
    return this.db
      .select()
      .from(externalParticipants)
      .where(eq(externalParticipants.sourceUpdateId, sourceUpdateId))
      .get();
  }

  public updateDisplayNameByTelegramUserId(telegramUserId: number, displayName: string): number[] {
    const affectedRows = this.db
      .select({ matchId: externalParticipants.matchId })
      .from(externalParticipants)
      .where(eq(externalParticipants.addedByTelegramUserId, telegramUserId))
      .all();

    this.db
      .update(externalParticipants)
      .set({ displayNameSnapshot: displayName })
      .where(eq(externalParticipants.addedByTelegramUserId, telegramUserId))
      .run();

    return [...new Set(affectedRows.map((row) => row.matchId))];
  }

  public listByMatchId(matchId: number): ExternalParticipant[] {
    return this.db
      .select()
      .from(externalParticipants)
      .where(eq(externalParticipants.matchId, matchId))
      .all();
  }
}

export function createExternalParticipantsRepository(
  db: AppDatabase,
): ExternalParticipantsRepository {
  return new ExternalParticipantsRepository(db);
}
