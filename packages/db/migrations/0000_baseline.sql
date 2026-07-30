CREATE TABLE "telegram_updates" (
  "update_id" bigint PRIMARY KEY,
  "status" text NOT NULL DEFAULT 'processing',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  "failed_at" timestamptz,
  "last_error" text,
  CONSTRAINT "telegram_updates_update_id_non_negative" CHECK ("update_id" >= 0),
  CONSTRAINT "telegram_updates_attempt_count_non_negative" CHECK ("attempt_count" >= 0),
  CONSTRAINT "telegram_updates_status_valid" CHECK ("status" IN ('processing', 'processed', 'failed')),
  CONSTRAINT "telegram_updates_status_timestamps_consistent" CHECK (
    ("status" = 'processing' AND "processed_at" IS NULL AND "failed_at" IS NULL)
    OR ("status" = 'processed' AND "processed_at" IS NOT NULL AND "failed_at" IS NULL)
    OR ("status" = 'failed' AND "processed_at" IS NULL AND "failed_at" IS NOT NULL AND "last_error" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "telegram_updates_status_idx" ON "telegram_updates" ("status", "received_at");
--> statement-breakpoint
CREATE TABLE "players" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "telegram_user_id" bigint,
  "display_name" text,
  "telegram_username_snapshot" text,
  "telegram_first_name_snapshot" text,
  "telegram_last_name_snapshot" text,
  "telegram_language_code" text,
  "last_seen_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "players_telegram_user_id_positive" CHECK ("telegram_user_id" IS NULL OR "telegram_user_id" > 0),
  CONSTRAINT "players_display_name_not_empty" CHECK ("display_name" IS NULL OR length(trim("display_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "players_telegram_user_id_unique" ON "players" ("telegram_user_id");
--> statement-breakpoint
CREATE INDEX "players_display_name_idx" ON "players" ("display_name");
--> statement-breakpoint
CREATE TABLE "matches" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "telegram_chat_id" bigint NOT NULL,
  "scheduled_at" timestamptz,
  "location" text,
  "venue_type" text,
  "field_price_rubles" integer,
  "title" text,
  "required_players" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "cancellation_reason" text,
  "creator_telegram_user_id" bigint NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "matches_telegram_chat_id_non_zero" CHECK ("telegram_chat_id" <> 0),
  CONSTRAINT "matches_creator_telegram_user_id_positive" CHECK ("creator_telegram_user_id" > 0),
  CONSTRAINT "matches_required_players_positive" CHECK ("required_players" >= 1),
  CONSTRAINT "matches_location_not_empty" CHECK ("location" IS NULL OR length(trim("location")) > 0),
  CONSTRAINT "matches_title_not_empty" CHECK ("title" IS NULL OR length(trim("title")) > 0),
  CONSTRAINT "matches_venue_type_valid" CHECK ("venue_type" IS NULL OR "venue_type" IN ('outdoor', 'indoor')),
  CONSTRAINT "matches_field_price_non_negative" CHECK ("field_price_rubles" IS NULL OR "field_price_rubles" >= 0),
  CONSTRAINT "matches_status_valid" CHECK ("status" IN ('draft', 'active', 'confirmed', 'completed', 'cancelled')),
  CONSTRAINT "matches_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "matches_cancellation_state_consistent" CHECK (
    ("status" = 'cancelled' AND "cancellation_reason" IS NOT NULL AND length(trim("cancellation_reason")) > 0)
    OR ("status" <> 'cancelled' AND "cancellation_reason" IS NULL)
  ),
  CONSTRAINT "matches_id_chat_unique" UNIQUE ("id", "telegram_chat_id")
);
--> statement-breakpoint
CREATE INDEX "matches_chat_status_idx" ON "matches" ("telegram_chat_id", "status");
--> statement-breakpoint
CREATE INDEX "matches_scheduled_at_idx" ON "matches" ("scheduled_at");
--> statement-breakpoint
CREATE TABLE "player_usernames" (
  "normalized_username" text PRIMARY KEY,
  "player_id" bigint NOT NULL,
  "last_seen_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "player_usernames_normalized_valid" CHECK (
    length("normalized_username") BETWEEN 1 AND 32
    AND "normalized_username" = lower("normalized_username")
    AND "normalized_username" !~ '@'
  ),
  CONSTRAINT "player_usernames_player_fk" FOREIGN KEY ("player_id") REFERENCES "players" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "player_usernames_player_idx" ON "player_usernames" ("player_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_player_username_rebinding() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.player_id IS DISTINCT FROM OLD.player_id THEN
    RAISE EXCEPTION 'A normalized Telegram username cannot be silently rebound to another player'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER player_usernames_no_silent_rebinding
  BEFORE UPDATE OF player_id ON "player_usernames"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_player_username_rebinding();
--> statement-breakpoint
CREATE TABLE "match_messages" (
  "match_id" bigint PRIMARY KEY,
  "telegram_chat_id" bigint NOT NULL,
  "telegram_topic_id" bigint,
  "telegram_message_id" bigint,
  "publication_state" text NOT NULL DEFAULT 'pending',
  "publication_attempted_at" timestamptz,
  "publication_uncertain_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "match_messages_match_chat_fk" FOREIGN KEY ("match_id", "telegram_chat_id") REFERENCES "matches" ("id", "telegram_chat_id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "match_messages_telegram_chat_id_non_zero" CHECK ("telegram_chat_id" <> 0),
  CONSTRAINT "match_messages_telegram_topic_id_positive" CHECK ("telegram_topic_id" IS NULL OR "telegram_topic_id" > 0),
  CONSTRAINT "match_messages_telegram_message_id_positive" CHECK ("telegram_message_id" IS NULL OR "telegram_message_id" > 0),
  CONSTRAINT "match_messages_publication_state_valid" CHECK ("publication_state" IN ('pending', 'published', 'uncertain', 'failed', 'deleted')),
  CONSTRAINT "match_messages_publication_reference_consistent" CHECK (
    ("publication_state" IN ('published', 'deleted') AND "telegram_message_id" IS NOT NULL)
    OR ("publication_state" IN ('pending', 'uncertain', 'failed') AND "telegram_message_id" IS NULL)
  ),
  CONSTRAINT "match_messages_uncertain_state_explicit" CHECK (
    ("publication_state" = 'uncertain' AND "publication_uncertain_at" IS NOT NULL)
    OR ("publication_state" <> 'uncertain' AND "publication_uncertain_at" IS NULL)
  ),
  CONSTRAINT "match_messages_attempt_state_consistent" CHECK (
    ("publication_state" = 'pending' AND "publication_attempted_at" IS NULL)
    OR ("publication_state" <> 'pending' AND "publication_attempted_at" IS NOT NULL)
  ),
  CONSTRAINT "match_messages_error_state_consistent" CHECK (
    ("publication_state" IN ('failed', 'uncertain') AND "last_error" IS NOT NULL AND length(trim("last_error")) > 0)
    OR ("publication_state" IN ('pending', 'published', 'deleted') AND "last_error" IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "match_messages_telegram_reference_unique" ON "match_messages" (
  "telegram_chat_id",
  coalesce("telegram_topic_id", 0),
  "telegram_message_id"
) WHERE "telegram_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "match_messages_publication_state_idx" ON "match_messages" ("publication_state", "updated_at");
--> statement-breakpoint
CREATE TABLE "votes" (
  "match_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "telegram_user_id" bigint NOT NULL,
  "username_snapshot" text,
  "first_name_snapshot" text,
  "last_name_snapshot" text,
  "display_name_snapshot" text NOT NULL,
  "option" text NOT NULL,
  "source" text NOT NULL,
  "telegram_update_id" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "votes_match_fk" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "votes_player_fk" FOREIGN KEY ("player_id") REFERENCES "players" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "votes_telegram_update_fk" FOREIGN KEY ("telegram_update_id") REFERENCES "telegram_updates" ("update_id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "votes_telegram_user_id_positive" CHECK ("telegram_user_id" > 0),
  CONSTRAINT "votes_option_valid" CHECK ("option" IN ('going', 'not_going', 'maybe')),
  CONSTRAINT "votes_source_valid" CHECK ("source" IN ('telegram_callback', 'owner_correction')),
  CONSTRAINT "votes_source_update_consistent" CHECK (
    ("source" = 'telegram_callback' AND "telegram_update_id" IS NOT NULL)
    OR ("source" = 'owner_correction' AND "telegram_update_id" IS NULL)
  ),
  CONSTRAINT "votes_match_player_pk" PRIMARY KEY ("match_id", "player_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "votes_match_telegram_user_unique" ON "votes" ("match_id", "telegram_user_id");
--> statement-breakpoint
CREATE INDEX "votes_match_option_idx" ON "votes" ("match_id", "option");
--> statement-breakpoint
CREATE INDEX "votes_player_idx" ON "votes" ("player_id");
--> statement-breakpoint
CREATE TABLE "external_participants" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "match_id" bigint NOT NULL,
  "created_by_telegram_user_id" bigint NOT NULL,
  "source_update_id" bigint,
  "display_name" text,
  "quantity" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "external_participants_match_fk" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "external_participants_source_update_fk" FOREIGN KEY ("source_update_id") REFERENCES "telegram_updates" ("update_id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "external_participants_created_by_positive" CHECK ("created_by_telegram_user_id" > 0),
  CONSTRAINT "external_participants_source_update_non_negative" CHECK ("source_update_id" IS NULL OR "source_update_id" >= 0),
  CONSTRAINT "external_participants_quantity_positive" CHECK ("quantity" >= 1),
  CONSTRAINT "external_participants_display_name_not_empty" CHECK ("display_name" IS NULL OR length(trim("display_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "external_participants_source_update_unique" ON "external_participants" ("source_update_id") WHERE "source_update_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "external_participants_match_idx" ON "external_participants" ("match_id");
--> statement-breakpoint
CREATE TABLE "http_idempotency_keys" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "owner_telegram_user_id" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'processing',
  "response_status" integer,
  "response_body" jsonb,
  "expires_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "http_idempotency_owner_positive" CHECK ("owner_telegram_user_id" > 0),
  CONSTRAINT "http_idempotency_key_not_empty" CHECK (length(trim("idempotency_key")) BETWEEN 1 AND 255),
  CONSTRAINT "http_idempotency_request_hash_not_empty" CHECK (length(trim("request_hash")) > 0),
  CONSTRAINT "http_idempotency_status_valid" CHECK ("status" IN ('processing', 'succeeded', 'failed')),
  CONSTRAINT "http_idempotency_response_status_valid" CHECK ("response_status" IS NULL OR "response_status" BETWEEN 100 AND 599),
  CONSTRAINT "http_idempotency_completion_consistent" CHECK (
    ("status" = 'processing' AND "completed_at" IS NULL)
    OR ("status" IN ('succeeded', 'failed') AND "completed_at" IS NOT NULL AND "response_status" IS NOT NULL)
  ),
  CONSTRAINT "http_idempotency_owner_key_unique" UNIQUE ("owner_telegram_user_id", "idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "http_idempotency_expiry_idx" ON "http_idempotency_keys" ("expires_at");
--> statement-breakpoint
CREATE TABLE "notifications" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "match_id" bigint,
  "telegram_chat_id" bigint NOT NULL,
  "notification_type" text NOT NULL,
  "transition_key" text NOT NULL,
  "weather_day" date,
  "delivery_state" text NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sent_at" timestamptz,
  "uncertain_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_match_fk" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "notifications_telegram_chat_id_non_zero" CHECK ("telegram_chat_id" <> 0),
  CONSTRAINT "notifications_type_valid" CHECK ("notification_type" IN ('threshold_reached', 'threshold_lost', 'withdrawal', 'match_confirmed', 'match_cancelled', 'weather_forecast')),
  CONSTRAINT "notifications_transition_key_not_empty" CHECK (length(trim("transition_key")) > 0),
  CONSTRAINT "notifications_scope_consistent" CHECK (
    ("notification_type" = 'weather_forecast' AND "match_id" IS NULL AND "weather_day" IS NOT NULL)
    OR ("notification_type" <> 'weather_forecast' AND "match_id" IS NOT NULL AND "weather_day" IS NULL)
  ),
  CONSTRAINT "notifications_delivery_state_valid" CHECK ("delivery_state" IN ('pending', 'sent', 'failed', 'uncertain')),
  CONSTRAINT "notifications_delivery_timestamps_consistent" CHECK (
    ("delivery_state" = 'sent' AND "sent_at" IS NOT NULL AND "uncertain_at" IS NULL)
    OR ("delivery_state" = 'uncertain' AND "sent_at" IS NULL AND "uncertain_at" IS NOT NULL)
    OR ("delivery_state" IN ('pending', 'failed') AND "sent_at" IS NULL AND "uncertain_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_match_type_transition_unique" ON "notifications" ("match_id", "notification_type", "transition_key") WHERE "match_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_weather_day_unique" ON "notifications" ("telegram_chat_id", "weather_day") WHERE "notification_type" = 'weather_forecast';
--> statement-breakpoint
CREATE INDEX "notifications_match_idx" ON "notifications" ("match_id", "created_at");
--> statement-breakpoint
CREATE INDEX "notifications_delivery_idx" ON "notifications" ("delivery_state", "updated_at");
--> statement-breakpoint
CREATE TABLE "outbox" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "event_type" text NOT NULL,
  "deduplication_key" text NOT NULL,
  "match_id" bigint,
  "notification_id" bigint,
  "telegram_chat_id" bigint NOT NULL,
  "telegram_topic_id" bigint,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "delivery_state" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "locked_at" timestamptz,
  "lease_expires_at" timestamptz,
  "delivered_at" timestamptz,
  "uncertain_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "outbox_match_fk" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "outbox_notification_fk" FOREIGN KEY ("notification_id") REFERENCES "notifications" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "outbox_event_type_valid" CHECK ("event_type" IN ('publish_public_card', 'refresh_public_card', 'delete_public_card', 'send_notification', 'reconcile_public_card')),
  CONSTRAINT "outbox_deduplication_key_not_empty" CHECK (length(trim("deduplication_key")) > 0),
  CONSTRAINT "outbox_telegram_chat_id_non_zero" CHECK ("telegram_chat_id" <> 0),
  CONSTRAINT "outbox_telegram_topic_id_positive" CHECK ("telegram_topic_id" IS NULL OR "telegram_topic_id" > 0),
  CONSTRAINT "outbox_attempt_count_non_negative" CHECK ("attempt_count" >= 0),
  CONSTRAINT "outbox_event_scope_consistent" CHECK (
    ("event_type" = 'send_notification' AND "notification_id" IS NOT NULL)
    OR ("event_type" <> 'send_notification' AND "match_id" IS NOT NULL)
  ),
  CONSTRAINT "outbox_delivery_state_valid" CHECK ("delivery_state" IN ('pending', 'processing', 'delivered', 'failed', 'uncertain')),
  CONSTRAINT "outbox_delivery_timestamps_consistent" CHECK (
    ("delivery_state" = 'delivered' AND "delivered_at" IS NOT NULL AND "uncertain_at" IS NULL)
    OR ("delivery_state" = 'uncertain' AND "delivered_at" IS NULL AND "uncertain_at" IS NOT NULL)
    OR ("delivery_state" IN ('pending', 'processing', 'failed') AND "delivered_at" IS NULL AND "uncertain_at" IS NULL)
  ),
  CONSTRAINT "outbox_error_consistent" CHECK (
    ("delivery_state" IN ('failed', 'uncertain') AND "last_error" IS NOT NULL AND length(trim("last_error")) > 0)
    OR ("delivery_state" IN ('pending', 'processing', 'delivered') AND "last_error" IS NULL)
  ),
  CONSTRAINT "outbox_deduplication_key_unique" UNIQUE ("deduplication_key")
);
--> statement-breakpoint
CREATE INDEX "outbox_delivery_queue_idx" ON "outbox" ("delivery_state", "available_at");
--> statement-breakpoint
CREATE INDEX "outbox_match_idx" ON "outbox" ("match_id", "created_at");
--> statement-breakpoint
CREATE TABLE "job_claims" (
  "job_name" text PRIMARY KEY,
  "claim_token" text NOT NULL,
  "claimed_at" timestamptz NOT NULL,
  "lease_expires_at" timestamptz NOT NULL,
  "last_completed_at" timestamptz,
  "last_error" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "job_claims_job_name_not_empty" CHECK (length(trim("job_name")) > 0),
  CONSTRAINT "job_claims_token_not_empty" CHECK (length(trim("claim_token")) > 0),
  CONSTRAINT "job_claims_lease_after_claim" CHECK ("lease_expires_at" > "claimed_at"),
  CONSTRAINT "job_claims_error_not_empty" CHECK ("last_error" IS NULL OR length(trim("last_error")) > 0)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER players_set_updated_at BEFORE UPDATE ON "players" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER matches_set_updated_at BEFORE UPDATE ON "matches" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER player_usernames_set_updated_at BEFORE UPDATE ON "player_usernames" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER match_messages_set_updated_at BEFORE UPDATE ON "match_messages" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER votes_set_updated_at BEFORE UPDATE ON "votes" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER external_participants_set_updated_at BEFORE UPDATE ON "external_participants" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER http_idempotency_keys_set_updated_at BEFORE UPDATE ON "http_idempotency_keys" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON "notifications" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER outbox_set_updated_at BEFORE UPDATE ON "outbox" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER job_claims_set_updated_at BEFORE UPDATE ON "job_claims" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
