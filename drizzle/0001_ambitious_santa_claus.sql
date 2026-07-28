CREATE TABLE `__new_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`notification_type` text NOT NULL,
	`transition_key` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "notifications_type_valid" CHECK("__new_notifications"."notification_type" in ('threshold_reached', 'threshold_lost', 'withdrawal', 'match_confirmed', 'match_cancelled', 'weather_forecast'))
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "match_id", "notification_type", "transition_key", "sent_at") SELECT "id", "match_id", "notification_type", "transition_key", "sent_at" FROM `notifications`;
--> statement-breakpoint
DROP TABLE `notifications`;
--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_idempotency_key` ON `notifications` (`match_id`,`notification_type`,`transition_key`);
--> statement-breakpoint
CREATE INDEX `notifications_match_idx` ON `notifications` (`match_id`);
--> statement-breakpoint
ALTER TABLE `external_participants` ADD COLUMN `source_label` text CHECK (`source_label` is null or length(trim(`source_label`)) > 0);
--> statement-breakpoint
ALTER TABLE `matches` ADD COLUMN `venue_type` text CHECK (`venue_type` is null or `venue_type` in ('outdoor', 'indoor'));
--> statement-breakpoint
ALTER TABLE `matches` ADD COLUMN `cancellation_reason` text CHECK (`cancellation_reason` is null or length(trim(`cancellation_reason`)) > 0);
