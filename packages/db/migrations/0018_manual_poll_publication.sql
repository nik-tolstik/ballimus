UPDATE "telegram_polls"
SET
  "publication_state" = CASE WHEN "archived_at" IS NULL THEN 'failed' ELSE 'cancelled' END,
  "publication_attempted_at" = now(),
  "last_error" = CASE
    WHEN "archived_at" IS NULL THEN 'Automatic publication did not complete. Check General and use manual republish.'
    ELSE NULL
  END,
  "updated_at" = now()
WHERE "publication_state" = 'pending';

UPDATE "outbox"
SET
  "delivery_state" = 'delivered',
  "delivered_at" = now(),
  "uncertain_at" = NULL,
  "last_error" = NULL,
  "locked_at" = NULL,
  "lease_expires_at" = NULL,
  "updated_at" = now()
WHERE "event_type" = 'publish_poll'
  AND "delivery_state" <> 'delivered';
