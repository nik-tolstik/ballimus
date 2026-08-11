CREATE TABLE "telegram_poll_voter_answers" (
  "poll_id" bigint NOT NULL,
  "voter_kind" text NOT NULL,
  "telegram_voter_id" bigint NOT NULL,
  "username" text,
  "display_name" text NOT NULL,
  "selected_option_indexes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_telegram_update_id" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "telegram_poll_voter_answers_pk" PRIMARY KEY("poll_id", "voter_kind", "telegram_voter_id"),
  CONSTRAINT "telegram_poll_voter_answers_poll_id_telegram_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "telegram_polls"("id") ON DELETE cascade ON UPDATE cascade,
  CONSTRAINT "telegram_poll_voter_answers_kind_valid" CHECK ("voter_kind" IN ('user', 'chat')),
  CONSTRAINT "telegram_poll_voter_answers_voter_id_non_zero" CHECK ("telegram_voter_id" <> 0),
  CONSTRAINT "telegram_poll_voter_answers_username_valid" CHECK ("username" IS NULL OR length(trim("username")) BETWEEN 1 AND 255),
  CONSTRAINT "telegram_poll_voter_answers_display_name_valid" CHECK (length(trim("display_name")) BETWEEN 1 AND 255),
  CONSTRAINT "telegram_poll_voter_answers_options_valid" CHECK (jsonb_typeof("selected_option_indexes") = 'array'),
  CONSTRAINT "telegram_poll_voter_answers_update_id_non_negative" CHECK ("last_telegram_update_id" >= 0)
);
--> statement-breakpoint
CREATE INDEX "telegram_poll_voter_answers_poll_idx" ON "telegram_poll_voter_answers" ("poll_id");
--> statement-breakpoint
CREATE TRIGGER telegram_poll_voter_answers_set_updated_at BEFORE UPDATE ON "telegram_poll_voter_answers" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
