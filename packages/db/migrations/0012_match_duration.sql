ALTER TABLE "matches" ADD COLUMN "duration_minutes" integer NOT NULL DEFAULT 90;
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_duration_minutes_valid" CHECK ("duration_minutes" BETWEEN 15 AND 480);
