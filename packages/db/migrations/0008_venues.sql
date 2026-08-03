CREATE TABLE "venues" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "name" text NOT NULL,
  "map_url" text NOT NULL,
  "venue_type" text NOT NULL,
  "booking_phones" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "website_url" text,
  "archived_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "venues_name_not_empty" CHECK (length(trim("venues"."name")) > 0),
  CONSTRAINT "venues_map_url_not_empty" CHECK (length(trim("venues"."map_url")) > 0),
  CONSTRAINT "venues_type_valid" CHECK ("venues"."venue_type" in ('outdoor', 'indoor')),
  CONSTRAINT "venues_booking_phones_limit" CHECK (cardinality("venues"."booking_phones") between 0 and 5),
  CONSTRAINT "venues_version_positive" CHECK ("venues"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "venues_name_ci_unique" ON "venues" USING btree (lower("name"));
--> statement-breakpoint
CREATE INDEX "venues_archived_at_idx" ON "venues" USING btree ("archived_at");
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "venue_id" bigint;
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "matches_venue_id_idx" ON "matches" USING btree ("venue_id");
