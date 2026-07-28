DELETE FROM `notifications`
WHERE `notification_type` = 'weather_forecast'
  AND `transition_key` GLOB 'forecast:*:*'
  AND `id` NOT IN (
    SELECT MIN(`id`)
    FROM `notifications`
    WHERE `notification_type` = 'weather_forecast'
      AND `transition_key` GLOB 'forecast:*:*'
    GROUP BY `notification_type`, `transition_key`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_weather_forecast_day_unique` ON `notifications` (`notification_type`,`transition_key`) WHERE "notifications"."notification_type" = 'weather_forecast' and "notifications"."transition_key" glob 'forecast:*:*';
