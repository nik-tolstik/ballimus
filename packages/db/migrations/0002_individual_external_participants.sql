INSERT INTO "external_participants" (
  "match_id",
  "created_by_telegram_user_id",
  "source_update_id",
  "display_name",
  "quantity",
  "created_at",
  "updated_at"
)
SELECT
  participant."match_id",
  participant."created_by_telegram_user_id",
  NULL,
  CASE
    WHEN participant."display_name" IS NULL THEN 'Дополнительный игрок #' || expanded."position"
    ELSE left(
      participant."display_name",
      greatest(1, 200 - length(' #' || expanded."position"))
    ) || ' #' || expanded."position"
  END,
  1,
  participant."created_at",
  participant."updated_at"
FROM "external_participants" AS participant
CROSS JOIN LATERAL generate_series(2, participant."quantity") AS expanded("position")
WHERE participant."quantity" > 1;
--> statement-breakpoint
UPDATE "external_participants"
SET
  "display_name" = CASE
    WHEN "display_name" IS NULL THEN 'Дополнительный игрок #1'
    ELSE left("display_name", greatest(1, 200 - length(' #1'))) || ' #1'
  END,
  "quantity" = 1
WHERE "quantity" > 1;
--> statement-breakpoint
ALTER TABLE "external_participants" DROP CONSTRAINT "external_participants_quantity_positive";
--> statement-breakpoint
ALTER TABLE "external_participants" ADD CONSTRAINT "external_participants_quantity_is_one" CHECK ("quantity" = 1);
