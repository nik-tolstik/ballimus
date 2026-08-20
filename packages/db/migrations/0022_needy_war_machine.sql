ALTER TABLE "matches" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "matches_archived_at_idx" ON "matches" USING btree ("telegram_chat_id","archived_at");