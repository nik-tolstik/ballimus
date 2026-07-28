import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

function applySqlFile(sqlite: Database.Database, relativePath: string): void {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  sqlite.exec(source.replaceAll("--> statement-breakpoint", "\n"));
}

function migrationHash(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(resolve(process.cwd(), relativePath), "utf8"))
    .digest("hex");
}

describe("SQLite migration upgrade", () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const sqlite of databases.splice(0)) sqlite.close();
  });

  it("preserves existing match and external-player rows while adding new fields", () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    sqlite.pragma("foreign_keys = ON");
    applySqlFile(sqlite, "drizzle/0000_inline_match_card.sql");

    sqlite.exec(`
      INSERT INTO chat_settings (chat_id, timezone) VALUES (-100, 'Europe/Minsk');
      INSERT INTO matches (
        chat_id, scheduled_at, location, required_players, status, creator_telegram_user_id
      ) VALUES (-100, 1785709200000, 'Ракета', 10, 'active', 7);
      INSERT INTO external_participants (
        match_id, added_by_telegram_user_id, source_update_id, quantity
      ) VALUES (1, 7, 10, 2);
      INSERT INTO notifications (match_id, notification_type, transition_key)
      VALUES (1, 'threshold_reached', 'legacy-threshold');
    `);

    sqlite.exec(`
      CREATE TABLE __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    ).run(migrationHash("drizzle/0000_inline_match_card.sql"), 1785164828506);

    migrate(drizzle(sqlite), { migrationsFolder: resolve(process.cwd(), "drizzle") });

    expect(sqlite.prepare(
      "SELECT venue_type AS venueType, cancellation_reason AS cancellationReason FROM matches WHERE id = 1",
    ).get()).toEqual({ venueType: null, cancellationReason: null });
    expect(sqlite.prepare(
      "SELECT source_label AS sourceLabel, display_name_snapshot AS displayNameSnapshot, quantity FROM external_participants WHERE match_id = 1",
    ).get()).toEqual({ sourceLabel: null, displayNameSnapshot: null, quantity: 2 });
    expect(sqlite.prepare(
      "SELECT notification_type AS notificationType, transition_key AS transitionKey FROM notifications",
    ).get()).toEqual({ notificationType: "threshold_reached", transitionKey: "legacy-threshold" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 5 });
    expect(sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'notifications_weather_forecast_day_unique'",
    ).get()).toMatchObject({ sql: expect.stringContaining("WHERE") });
  });

  it("preserves legacy forecasts and deduplicates existing daily forecast claims", () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    sqlite.pragma("foreign_keys = ON");
    applySqlFile(sqlite, "drizzle/0000_inline_match_card.sql");
    applySqlFile(sqlite, "drizzle/0001_ambitious_santa_claus.sql");

    sqlite.exec(`
      INSERT INTO chat_settings (chat_id, timezone) VALUES (-100, 'Europe/Minsk');
      INSERT INTO matches (
        chat_id, scheduled_at, location, required_players, status, creator_telegram_user_id
      ) VALUES
        (-100, 1785709200000, 'Ракета', 10, 'active', 7),
        (-100, 1785712800000, 'Стадион', 10, 'active', 7);
      INSERT INTO notifications (match_id, notification_type, transition_key) VALUES
        (1, 'weather_forecast', 'forecast:1785709200000'),
        (2, 'weather_forecast', 'forecast:1785709200000'),
        (1, 'weather_forecast', 'forecast:-100:2026-08-02'),
        (2, 'weather_forecast', 'forecast:-100:2026-08-02');
      CREATE TABLE __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    ).run(migrationHash("drizzle/0000_inline_match_card.sql"), 1785164828506);
    sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    ).run(migrationHash("drizzle/0001_ambitious_santa_claus.sql"), 1785233957272);

    migrate(drizzle(sqlite), { migrationsFolder: resolve(process.cwd(), "drizzle") });

    expect(sqlite.prepare(
      "SELECT count(*) AS count FROM notifications WHERE notification_type = 'weather_forecast'",
    ).get()).toEqual({ count: 3 });
    expect(sqlite.prepare(
      "SELECT match_id AS matchId FROM notifications WHERE transition_key = 'forecast:-100:2026-08-02'",
    ).get()).toEqual({ matchId: 1 });
    sqlite.prepare(
      "INSERT INTO notifications (match_id, notification_type, transition_key) VALUES (?, ?, ?)",
    ).run(1, "weather_forecast", "forecast:-100:2026-08-03");
    expect(() => sqlite.prepare(
      "INSERT INTO notifications (match_id, notification_type, transition_key) VALUES (?, ?, ?)",
    ).run(2, "weather_forecast", "forecast:-100:2026-08-03")).toThrow();
  });
});
