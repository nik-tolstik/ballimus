DELETE FROM "outbox"
WHERE "event_type" IN ('publish_poll', 'delete_poll', 'send_poll_threshold_notification');
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_event_type_valid";
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_event_scope_consistent";
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_type_valid" CHECK (
  "event_type" IN ('publish_public_card', 'refresh_public_card', 'delete_public_card')
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_scope_consistent" CHECK (
  "event_type" = 'delete_public_card' OR "match_id" IS NOT NULL
);
