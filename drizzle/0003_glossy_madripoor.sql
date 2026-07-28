CREATE TABLE `user_aliases` (
	`username` text PRIMARY KEY NOT NULL,
	`telegram_user_id` integer,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "user_aliases_username_not_empty" CHECK(length(trim("user_aliases"."username")) > 0),
	CONSTRAINT "user_aliases_display_name_not_empty" CHECK(length(trim("user_aliases"."display_name")) > 0)
);
--> statement-breakpoint
CREATE INDEX `user_aliases_telegram_user_idx` ON `user_aliases` (`telegram_user_id`);