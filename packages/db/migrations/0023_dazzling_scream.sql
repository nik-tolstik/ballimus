CREATE TABLE "telegram_poll_vote_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telegram_poll_vote_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"poll_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"voter_kind" text NOT NULL,
	"telegram_voter_id" bigint NOT NULL,
	"username" text,
	"display_name" text NOT NULL,
	"previous_selected_option_indexes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_option_indexes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"telegram_update_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_poll_vote_events_update_unique" UNIQUE("poll_id","voter_kind","telegram_voter_id","telegram_update_id"),
	CONSTRAINT "telegram_poll_vote_events_kind_valid" CHECK ("telegram_poll_vote_events"."kind" in ('voted', 'changed', 'cancelled')),
	CONSTRAINT "telegram_poll_vote_events_voter_kind_valid" CHECK ("telegram_poll_vote_events"."voter_kind" in ('user', 'chat')),
	CONSTRAINT "telegram_poll_vote_events_voter_id_non_zero" CHECK ("telegram_poll_vote_events"."telegram_voter_id" <> 0),
	CONSTRAINT "telegram_poll_vote_events_username_valid" CHECK ("telegram_poll_vote_events"."username" is null or length(trim("telegram_poll_vote_events"."username")) between 1 and 255),
	CONSTRAINT "telegram_poll_vote_events_display_name_valid" CHECK (length(trim("telegram_poll_vote_events"."display_name")) between 1 and 255),
	CONSTRAINT "telegram_poll_vote_events_previous_options_valid" CHECK (jsonb_typeof("telegram_poll_vote_events"."previous_selected_option_indexes") = 'array'),
	CONSTRAINT "telegram_poll_vote_events_options_valid" CHECK (jsonb_typeof("telegram_poll_vote_events"."selected_option_indexes") = 'array'),
	CONSTRAINT "telegram_poll_vote_events_update_id_non_negative" CHECK ("telegram_poll_vote_events"."telegram_update_id" >= 0)
);
--> statement-breakpoint
ALTER TABLE "telegram_poll_vote_events" ADD CONSTRAINT "telegram_poll_vote_events_poll_id_telegram_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "telegram_polls"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "telegram_poll_vote_events_poll_id_idx" ON "telegram_poll_vote_events" USING btree ("poll_id","id");
