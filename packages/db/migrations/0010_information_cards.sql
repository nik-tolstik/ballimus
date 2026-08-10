-- Preserve every legacy Telegram card reference as a durable delete request before removing its source data.
DELETE FROM "outbox";
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT IF EXISTS "outbox_event_scope_consistent";
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT IF EXISTS "outbox_event_type_valid";
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT IF EXISTS "outbox_notification_fk";
--> statement-breakpoint
ALTER TABLE "outbox" DROP COLUMN IF EXISTS "notification_id";
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_type_valid" CHECK (
  "event_type" IN ('publish_public_card', 'refresh_public_card', 'delete_public_card', 'reconcile_public_card')
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_scope_consistent" CHECK (
  "event_type" = 'delete_public_card' OR "match_id" IS NOT NULL
);
--> statement-breakpoint
INSERT INTO "outbox" (
  "event_type",
  "deduplication_key",
  "match_id",
  "telegram_chat_id",
  "telegram_topic_id",
  "payload",
  "delivery_state",
  "attempt_count",
  "available_at",
  "created_at",
  "updated_at"
)
SELECT
  'delete_public_card',
  'legacy-card-delete:' || message."telegram_chat_id" || ':' || coalesce(message."telegram_topic_id", 0) || ':' || message."telegram_message_id",
  NULL,
  message."telegram_chat_id",
  message."telegram_topic_id",
  jsonb_build_object('telegramMessageId', message."telegram_message_id"::text, 'legacy', true),
  'pending',
  0,
  now(),
  now(),
  now()
FROM "match_messages" AS message
WHERE message."telegram_message_id" IS NOT NULL
  AND message."publication_state" IN ('published', 'deleted');
--> statement-breakpoint
DELETE FROM "matches";
--> statement-breakpoint
DROP TABLE IF EXISTS "external_participants";
--> statement-breakpoint
DROP TABLE IF EXISTS "votes";
--> statement-breakpoint
DROP TABLE IF EXISTS "player_usernames";
--> statement-breakpoint
DROP TABLE IF EXISTS "players";
--> statement-breakpoint
DROP TABLE IF EXISTS "telegram_updates";
--> statement-breakpoint
DROP TABLE IF EXISTS "notifications";
--> statement-breakpoint
DROP FUNCTION IF EXISTS prevent_player_username_rebinding();
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_venue_id_venues_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_required_players_positive";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_location_not_empty";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_title_not_empty";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_venue_type_valid";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_status_valid";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_cancellation_state_consistent";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_time_mode_valid";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_selected_time_valid";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_time_configuration_consistent";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "schedule_date";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "time_mode";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "time_options";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "selected_time";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "location";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "venue_type";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "title";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "required_players";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "status";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN IF EXISTS "cancellation_reason";
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "scheduled_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "venue_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "deletion_requested_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
DROP INDEX IF EXISTS "matches_chat_status_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "matches_scheduled_at_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "outbox_match_idx";
--> statement-breakpoint
CREATE INDEX "matches_active_idx" ON "matches" ("telegram_chat_id", "deletion_requested_at", "scheduled_at");
