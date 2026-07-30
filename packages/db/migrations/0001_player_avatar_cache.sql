ALTER TABLE "players" ADD COLUMN "avatar_file_unique_id" text;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "avatar_content_type" text;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "avatar_data_base64" text;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "avatar_refreshed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_avatar_content_type_valid" CHECK ("avatar_content_type" IS NULL OR "avatar_content_type" IN ('image/jpeg', 'image/png', 'image/webp'));
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_avatar_cache_consistent" CHECK (
  ("avatar_file_unique_id" IS NULL AND "avatar_content_type" IS NULL AND "avatar_data_base64" IS NULL)
  OR (
    "avatar_file_unique_id" IS NOT NULL
    AND length(trim("avatar_file_unique_id")) > 0
    AND "avatar_content_type" IS NOT NULL
    AND "avatar_data_base64" IS NOT NULL
    AND length("avatar_data_base64") BETWEEN 1 AND 349528
  )
);
