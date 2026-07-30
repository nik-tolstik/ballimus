ALTER TABLE "votes" ADD COLUMN "exact_times" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "votes" AS "vote"
SET "exact_times" = jsonb_build_array("vote"."available_after"),
    "available_after" = null
FROM "matches" AS "match"
WHERE "vote"."match_id" = "match"."id"
  AND "match"."time_mode" = 'exact_options'
  AND "vote"."option" = 'going'
  AND "vote"."available_after" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "votes" DROP CONSTRAINT "votes_available_after_option_consistent";
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_available_after_option_consistent" CHECK (
  "option" = 'going' or ("available_after" is null and jsonb_array_length("exact_times") = 0)
);
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_exact_times_array" CHECK (jsonb_typeof("exact_times") = 'array');
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_time_selection_consistent" CHECK (
  "available_after" is null or jsonb_array_length("exact_times") = 0
);
