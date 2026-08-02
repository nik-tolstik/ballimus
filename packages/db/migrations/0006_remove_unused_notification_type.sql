ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_valid";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_valid" CHECK (
  "notification_type" IN ('threshold_reached', 'threshold_lost', 'match_confirmed', 'match_cancelled', 'weather_forecast')
) NOT VALID;
--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_type_valid";
