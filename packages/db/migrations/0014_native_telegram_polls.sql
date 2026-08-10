CREATE TABLE "telegram_polls" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "telegram_poll_id" text,
  "telegram_chat_id" bigint NOT NULL,
  "telegram_topic_id" bigint,
  "telegram_message_id" bigint,
  "question" text NOT NULL,
  "options" jsonb NOT NULL,
  "is_anonymous" boolean DEFAULT true NOT NULL,
  "allows_multiple_answers" boolean DEFAULT false NOT NULL,
  "publication_state" text DEFAULT 'pending' NOT NULL,
  "publication_attempted_at" timestamptz,
  "closed_at" timestamptz,
  "last_error" text,
  "creator_telegram_user_id" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "telegram_polls_chat_id_non_zero" CHECK ("telegram_chat_id" <> 0),
  CONSTRAINT "telegram_polls_topic_id_positive" CHECK ("telegram_topic_id" IS NULL OR "telegram_topic_id" > 0),
  CONSTRAINT "telegram_polls_message_id_positive" CHECK ("telegram_message_id" IS NULL OR "telegram_message_id" > 0),
  CONSTRAINT "telegram_polls_question_valid" CHECK (length("question") BETWEEN 1 AND 300),
  CONSTRAINT "telegram_polls_options_valid" CHECK (jsonb_typeof("options") = 'array' AND jsonb_array_length("options") BETWEEN 2 AND 12),
  CONSTRAINT "telegram_polls_publication_state_valid" CHECK ("publication_state" IN ('pending', 'published', 'uncertain', 'failed')),
  CONSTRAINT "telegram_polls_creator_positive" CHECK ("creator_telegram_user_id" > 0),
  CONSTRAINT "telegram_polls_publication_reference_consistent" CHECK (
    ("publication_state" = 'published' AND "telegram_poll_id" IS NOT NULL AND "telegram_message_id" IS NOT NULL)
    OR ("publication_state" IN ('pending', 'uncertain', 'failed') AND "telegram_poll_id" IS NULL AND "telegram_message_id" IS NULL)
  ),
  CONSTRAINT "telegram_polls_attempt_state_consistent" CHECK (
    ("publication_state" = 'pending' AND "publication_attempted_at" IS NULL)
    OR ("publication_state" <> 'pending' AND "publication_attempted_at" IS NOT NULL)
  ),
  CONSTRAINT "telegram_polls_error_state_consistent" CHECK (
    ("publication_state" IN ('failed', 'uncertain') AND "last_error" IS NOT NULL AND length(trim("last_error")) > 0)
    OR ("publication_state" IN ('pending', 'published') AND "last_error" IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_polls_telegram_poll_id_unique" ON "telegram_polls" ("telegram_poll_id") WHERE "telegram_poll_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "telegram_polls_chat_created_idx" ON "telegram_polls" ("telegram_chat_id", "created_at");
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_event_type_valid";
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_event_scope_consistent";
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_type_valid" CHECK (
  "event_type" IN ('publish_public_card', 'refresh_public_card', 'delete_public_card', 'publish_poll', 'send_poll_threshold_notification')
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_scope_consistent" CHECK (
  "event_type" IN ('delete_public_card', 'publish_poll', 'send_poll_threshold_notification') OR "match_id" IS NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER telegram_polls_set_updated_at BEFORE UPDATE ON "telegram_polls" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
