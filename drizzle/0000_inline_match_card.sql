CREATE TABLE `chat_settings` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`general_topic_id` integer,
	`chat_topic_id` integer,
	`timezone` text NOT NULL,
	`default_threshold` integer DEFAULT 10 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "chat_settings_default_threshold_positive" CHECK("chat_settings"."default_threshold" >= 1)
);
--> statement-breakpoint
CREATE INDEX `chat_settings_chat_topic_idx` ON `chat_settings` (`chat_topic_id`);--> statement-breakpoint
CREATE TABLE `external_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`added_by_telegram_user_id` integer NOT NULL,
	`source_update_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "external_participants_source_update_non_negative" CHECK("external_participants"."source_update_id" >= 0),
	CONSTRAINT "external_participants_quantity_non_zero" CHECK("external_participants"."quantity" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_participants_source_update_unique` ON `external_participants` (`source_update_id`);--> statement-breakpoint
CREATE INDEX `external_participants_match_idx` ON `external_participants` (`match_id`);--> statement-breakpoint
CREATE TABLE `match_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`kind` text NOT NULL,
	`message_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`topic_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "match_messages_kind_valid" CHECK("match_messages"."kind" in ('public_card', 'admin_panel')),
	CONSTRAINT "match_messages_message_id_positive" CHECK("match_messages"."message_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_messages_match_kind_unique` ON `match_messages` (`match_id`,`kind`);--> statement-breakpoint
CREATE INDEX `match_messages_chat_topic_idx` ON `match_messages` (`chat_id`,`topic_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`scheduled_at` integer,
	`location` text,
	`field_price_rubles` integer,
	`title` text,
	`required_players` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`creator_telegram_user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat_settings`(`chat_id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "matches_required_players_positive" CHECK("matches"."required_players" >= 1),
	CONSTRAINT "matches_location_not_empty" CHECK("matches"."location" is null or length(trim("matches"."location")) > 0),
	CONSTRAINT "matches_field_price_non_negative" CHECK("matches"."field_price_rubles" is null or "matches"."field_price_rubles" >= 0),
	CONSTRAINT "matches_status_valid" CHECK("matches"."status" in ('draft', 'active', 'confirmed', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_id_chat_unique` ON `matches` (`id`,`chat_id`);--> statement-breakpoint
CREATE INDEX `matches_chat_status_idx` ON `matches` (`chat_id`,`status`);--> statement-breakpoint
CREATE INDEX `matches_scheduled_at_idx` ON `matches` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`notification_type` text NOT NULL,
	`transition_key` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "notifications_type_valid" CHECK("notifications"."notification_type" in ('threshold_reached', 'withdrawal', 'match_confirmed', 'match_cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_idempotency_key` ON `notifications` (`match_id`,`notification_type`,`transition_key`);--> statement-breakpoint
CREATE INDEX `notifications_match_idx` ON `notifications` (`match_id`);--> statement-breakpoint
CREATE TABLE `processed_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`match_id` integer NOT NULL,
	`action` text NOT NULL,
	`telegram_user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "processed_updates_update_id_non_negative" CHECK("processed_updates"."update_id" >= 0)
);
--> statement-breakpoint
CREATE INDEX `processed_updates_match_idx` ON `processed_updates` (`match_id`);--> statement-breakpoint
CREATE TABLE `votes` (
	`match_id` integer NOT NULL,
	`telegram_user_id` integer NOT NULL,
	`username_snapshot` text,
	`display_name_snapshot` text NOT NULL,
	`option` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`match_id`, `telegram_user_id`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "votes_option_valid" CHECK("votes"."option" in ('going', 'not_going', 'maybe'))
);
--> statement-breakpoint
CREATE INDEX `votes_match_option_idx` ON `votes` (`match_id`,`option`);--> statement-breakpoint
CREATE INDEX `votes_telegram_user_idx` ON `votes` (`telegram_user_id`);