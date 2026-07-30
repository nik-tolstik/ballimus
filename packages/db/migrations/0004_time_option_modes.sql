ALTER TABLE "matches" DROP CONSTRAINT "matches_time_mode_valid";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_time_configuration_consistent";
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_time_mode_valid" CHECK ("time_mode" in ('exact', 'exact_options', 'availability'));
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_time_configuration_consistent" CHECK (
  ("time_mode" = 'exact' and jsonb_array_length("time_options") = 0 and "selected_time" is null)
  or (
    "time_mode" in ('exact_options', 'availability')
    and "schedule_date" is not null
    and jsonb_typeof("time_options") = 'array'
    and jsonb_array_length("time_options") between 1 and 6
    and ("selected_time" is null or "time_options" ? "selected_time")
  )
);
