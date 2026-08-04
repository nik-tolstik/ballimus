ALTER TABLE "venues" ADD COLUMN "booking_contacts" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
UPDATE "venues"
SET "booking_contacts" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object('phone', phone))
    FROM unnest("booking_phones") AS phone
  ),
  '[]'::jsonb
);
--> statement-breakpoint
ALTER TABLE "venues" DROP CONSTRAINT "venues_booking_phones_limit";
--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "booking_phones";
--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_booking_contacts_valid" CHECK (
  CASE
    WHEN jsonb_typeof("booking_contacts") = 'array' THEN jsonb_array_length("booking_contacts") BETWEEN 0 AND 5
    ELSE false
  END
);
