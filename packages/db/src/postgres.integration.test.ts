import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  MatchMessagesRepository,
  MatchesRepository,
  OutboxRepository,
  VenuesRepository,
} from "./index.js";
import {
  createPostgresTestDatabase,
  resetPostgresTestDatabase,
  type PostgresTestDatabase,
} from "./test-support/postgres.js";

const TEST_TIMEOUT_MS = 30_000;
const CHAT_ID = -100_700_001n;
const OWNER_ID = 700_001n;

let database: PostgresTestDatabase;

describe("information-card PostgreSQL schema", () => {
  beforeAll(async () => {
    database = await createPostgresTestDatabase();
  }, TEST_TIMEOUT_MS);

  beforeEach(async () => {
    await resetPostgresTestDatabase(database);
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, TEST_TIMEOUT_MS);

  it("contains only information-card application tables after the cleanup migration", async () => {
    const tables = await database.sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = ${database.schemaName} and table_type = 'BASE TABLE'
      order by table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual([
      "http_idempotency_keys",
      "job_claims",
      "match_messages",
      "matches",
      "outbox",
      "venues",
    ]);
  });

  it("requires a venue and supports idempotent deletion of a card", async () => {
    const venues = new VenuesRepository(database.db);
    const matches = new MatchesRepository(database.db);
    const messages = new MatchMessagesRepository(database.db);
    const outbox = new OutboxRepository(database.db);
    const venue = await venues.create({
      name: "Local card venue",
      mapUrl: "https://maps.example.test/local-card-venue",
      venueType: "indoor",
    });
    const match = await matches.create({
      telegramChatId: CHAT_ID,
      scheduledAt: new Date("2026-08-02T17:00:00.000Z"),
      durationMinutes: 90,
      venueId: venue.id,
      fieldPriceRubles: 100,
      creatorTelegramUserId: OWNER_ID,
    });
    await messages.createPending(match.id, CHAT_ID, 1n);
    await messages.markPublished(match.id, 101n);
    await outbox.insert({
      eventType: "delete_public_card",
      deduplicationKey: `match:${match.id.toString(10)}:delete`,
      matchId: match.id,
      telegramChatId: CHAT_ID,
      telegramTopicId: 1n,
      payload: { telegramMessageId: "101" },
    });

    const firstDeletion = await matches.requestDeletion(match.id, match.version);
    const repeatedDeletion = await matches.requestDeletion(match.id, 1);

    expect(match.durationMinutes).toBe(90);
    expect(firstDeletion.deletionRequestedAt).toBeInstanceOf(Date);
    expect(repeatedDeletion.deletionRequestedAt).toEqual(firstDeletion.deletionRequestedAt);
    expect(await matches.list({ telegramChatId: CHAT_ID })).toEqual([]);
    expect((await outbox.findByDeduplicationKey(`match:${match.id.toString(10)}:delete`))?.eventType).toBe("delete_public_card");
  });
});
