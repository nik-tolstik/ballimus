DELETE FROM "venues"
WHERE "archived_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "matches"
    WHERE "matches"."venue_id" = "venues"."id"
  );--> statement-breakpoint
DROP INDEX "venues_archived_at_idx";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "archived_at";
