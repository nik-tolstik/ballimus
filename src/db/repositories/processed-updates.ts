import { eq } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import { processedUpdates, type ProcessedUpdate } from "../schema.js";

export interface ClaimProcessedUpdateInput {
  updateId: number;
  matchId: number;
  action: string;
  telegramUserId: number;
  createdAt?: Date;
}

export class ProcessedUpdatesRepository {
  public constructor(private readonly db: AppDatabase) {}

  public findByUpdateId(updateId: number): ProcessedUpdate | undefined {
    return this.db
      .select()
      .from(processedUpdates)
      .where(eq(processedUpdates.updateId, updateId))
      .get();
  }

  public claim(input: ClaimProcessedUpdateInput): ProcessedUpdate | undefined {
    return this.db
      .insert(processedUpdates)
      .values({
        updateId: input.updateId,
        matchId: input.matchId,
        action: input.action,
        telegramUserId: input.telegramUserId,
        createdAt: input.createdAt ?? new Date(),
      })
      .onConflictDoNothing({ target: processedUpdates.updateId })
      .returning()
      .get();
  }
}

export function createProcessedUpdatesRepository(db: AppDatabase): ProcessedUpdatesRepository {
  return new ProcessedUpdatesRepository(db);
}
