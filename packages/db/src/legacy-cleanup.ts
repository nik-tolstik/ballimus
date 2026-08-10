import { and, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "./client.js";
import { outbox } from "./schema.js";

/** Removes delivered migration-only legacy card deletion events after Telegram confirms delivery. */
export async function cleanupDeliveredLegacyCardDeletions(db: AppDatabase): Promise<number> {
  const rows = await db
    .delete(outbox)
    .where(and(
      eq(outbox.eventType, "delete_public_card"),
      isNull(outbox.matchId),
      eq(outbox.deliveryState, "delivered"),
    ))
    .returning({ id: outbox.id });
  return rows.length;
}
