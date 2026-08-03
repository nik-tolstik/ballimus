ALTER TABLE "external_participants" ADD COLUMN "available_after" text;
--> statement-breakpoint
ALTER TABLE "external_participants" ADD CONSTRAINT "external_participants_available_after_valid" CHECK (
  "available_after" is null or "available_after" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
);
