ALTER TABLE "outbox" DROP CONSTRAINT IF EXISTS "outbox_event_type_valid";
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_type_valid" CHECK (
  "event_type" IN ('publish_public_card', 'refresh_public_card', 'delete_public_card')
);
