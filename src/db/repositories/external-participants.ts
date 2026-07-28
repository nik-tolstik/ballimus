import { eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  externalParticipants,
  type ExternalParticipant,
} from "../schema.js";

export interface AddExternalParticipantInput {
  matchId: number;
  addedByTelegramUserId: number;
  sourceUpdateId: number;
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
