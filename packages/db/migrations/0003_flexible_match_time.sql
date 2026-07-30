ALTER TABLE "matches" ADD COLUMN "schedule_date" date;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "time_mode" text DEFAULT 'exact' NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "time_options" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "selected_time" text;
--> statement-breakpoint
UPDATE "matches"
SET "schedule_date" = ("scheduled_at" AT TIME ZONE 'Europe/Minsk')::date
WHERE "scheduled_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_time_mode_valid" CHECK ("time_mode" in ('exact', 'availability'));
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_selected_time_valid" CHECK ("selected_time" is null or "selected_time" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_time_configuration_consistent" CHECK (
  ("time_mode" = 'exact' and jsonb_array_length("time_options") = 0 and "selected_time" is null)
  or (
    "time_mode" = 'availability'
    and "schedule_date" is not null
    and jsonb_typeof("time_options") = 'array'
    and jsonb_array_length("time_options") between 2 and 6
    and ("selected_time" is null or "time_options" ? "selected_time")
  )
);
--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "available_after" text;
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_available_after_valid" CHECK ("available_after" is null or "available_after" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_available_after_option_consistent" CHECK ("option" = 'going' or "available_after" is null);
