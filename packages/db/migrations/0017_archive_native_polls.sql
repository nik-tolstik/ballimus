ALTER TABLE "telegram_polls" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "telegram_polls" DROP CONSTRAINT "telegram_polls_publication_state_valid";
--> statement-breakpoint
ALTER TABLE "telegram_polls" DROP CONSTRAINT "telegram_polls_publication_reference_consistent";
--> statement-breakpoint
ALTER TABLE "telegram_polls" DROP CONSTRAINT "telegram_polls_attempt_state_consistent";
--> statement-breakpoint
ALTER TABLE "telegram_polls" DROP CONSTRAINT "telegram_polls_error_state_consistent";
--> statement-breakpoint
ALTER TABLE "telegram_polls" ADD CONSTRAINT "telegram_polls_publication_state_valid" CHECK (
  "publication_state" IN ('pending', 'published', 'uncertain', 'failed', 'cancelled')
);
--> statement-breakpoint
ALTER TABLE "telegram_polls" ADD CONSTRAINT "telegram_polls_publication_reference_consistent" CHECK (
  ("publication_state" = 'published' AND "telegram_poll_id" IS NOT NULL AND "telegram_message_id" IS NOT NULL)
  OR ("publication_state" IN ('pending', 'uncertain', 'failed', 'cancelled') AND "telegram_poll_id" IS NULL AND "telegram_message_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "telegram_polls" ADD CONSTRAINT "telegram_polls_attempt_state_consistent" CHECK (
  ("publication_state" = 'pending' AND "publication_attempted_at" IS NULL)
  OR ("publication_state" <> 'pending' AND "publication_attempted_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "telegram_polls" ADD CONSTRAINT "telegram_polls_error_state_consistent" CHECK (
  ("publication_state" IN ('failed', 'uncertain') AND "last_error" IS NOT NULL AND length(trim("last_error")) > 0)
  OR ("publication_state" IN ('pending', 'published', 'cancelled') AND "last_error" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_event_type_valid";
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_event_scope_consistent";
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_type_valid" CHECK (
  "event_type" IN ('publish_public_card', 'refresh_public_card', 'delete_public_card', 'publish_poll', 'delete_poll', 'send_poll_threshold_notification')
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_scope_consistent" CHECK (
  "event_type" IN ('delete_public_card', 'publish_poll', 'delete_poll', 'send_poll_threshold_notification') OR "match_id" IS NOT NULL
);
