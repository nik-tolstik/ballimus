ALTER TABLE "telegram_polls" ADD COLUMN "notification_threshold" integer;
--> statement-breakpoint
ALTER TABLE "telegram_polls" ADD COLUMN "allows_revoting" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "telegram_polls" AS "poll"
SET
  "notification_threshold" = "migrated"."notification_threshold",
  "options" = "migrated"."options"
FROM (
  SELECT
    "source"."id",
    (
      SELECT min(("entry"."value"->>'notificationThreshold')::integer)
      FROM jsonb_array_elements("source"."options") AS "entry"("value")
      WHERE "entry"."value"->>'notificationThreshold' IS NOT NULL
    ) AS "notification_threshold",
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'text', "entry"."value"->>'text',
          'notificationEnabled', "entry"."value"->>'notificationThreshold' IS NOT NULL,
          'voterCount', COALESCE(("entry"."value"->>'voterCount')::integer, 0),
          'notificationQueuedAt', "entry"."value"->'notificationQueuedAt'
        )
        ORDER BY "entry"."ordinality"
      )
      FROM jsonb_array_elements("source"."options") WITH ORDINALITY AS "entry"("value", "ordinality")
    ) AS "options"
  FROM "telegram_polls" AS "source"
) AS "migrated"
WHERE "poll"."id" = "migrated"."id";
--> statement-breakpoint
ALTER TABLE "telegram_polls" ADD CONSTRAINT "telegram_polls_notification_threshold_valid" CHECK (
  "notification_threshold" IS NULL OR "notification_threshold" BETWEEN 1 AND 1000000
);
