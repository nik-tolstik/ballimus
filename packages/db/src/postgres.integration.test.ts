import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  MatchMessagesRepository,
  MatchesRepository,
  OutboxRepository,
  TelegramPollsRepository,
  VenuesRepository,
} from "./index.js";
import { telegramPollVoterAnswers } from "./schema.js";
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
      "telegram_poll_voter_answers",
      "telegram_polls",
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

  it("permanently deletes unreferenced venues and protects venues used by matches", async () => {
    const venues = new VenuesRepository(database.db);
    const matches = new MatchesRepository(database.db);
    const unused = await venues.create({
      name: "Unused venue",
      mapUrl: "https://maps.example.test/unused-venue",
      venueType: "outdoor",
    });

    await expect(venues.delete(unused.id, unused.version)).resolves.toBe(true);
    await expect(venues.findById(unused.id)).resolves.toBeUndefined();

    const used = await venues.create({
      name: "Used venue",
      mapUrl: "https://maps.example.test/used-venue",
      venueType: "indoor",
    });
    const match = await matches.create({
      telegramChatId: CHAT_ID,
      scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
      durationMinutes: 90,
      venueId: used.id,
      creatorTelegramUserId: OWNER_ID,
    });

    await expect(venues.delete(used.id, used.version)).rejects.toMatchObject({
      name: "VenueInUseRepositoryError",
    });
    await expect(matches.findById(match.id)).resolves.toMatchObject({ venueId: used.id });
  });

  it("isolates archived matches from active cards, orders them newest first, and permits permanent deletion", async () => {
    const venues = new VenuesRepository(database.db);
    const matches = new MatchesRepository(database.db);
    const venue = await venues.create({
      name: "Archive test venue",
      mapUrl: "https://maps.example.test/archive-test-venue",
      venueType: "indoor",
    });
    const first = await matches.create({
      telegramChatId: CHAT_ID,
      scheduledAt: new Date("2026-08-02T17:00:00.000Z"),
      durationMinutes: 90,
      venueId: venue.id,
      creatorTelegramUserId: OWNER_ID,
    });
    const second = await matches.create({
      telegramChatId: CHAT_ID,
      scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
      durationMinutes: 120,
      venueId: venue.id,
      creatorTelegramUserId: OWNER_ID,
    });
    const active = await matches.create({
      telegramChatId: CHAT_ID,
      scheduledAt: new Date("2026-08-04T17:00:00.000Z"),
      durationMinutes: 60,
      venueId: venue.id,
      creatorTelegramUserId: OWNER_ID,
    });

    const archivedFirst = await matches.archive(first.id, first.version, new Date("2026-08-10T12:00:00.000Z"));
    const archivedSecond = await matches.archive(second.id, second.version, new Date("2026-08-11T12:00:00.000Z"));

    expect((await matches.list({ telegramChatId: CHAT_ID })).map((match) => match.id)).toEqual([active.id]);
    expect((await matches.list({ telegramChatId: CHAT_ID, archived: true })).map((match) => match.id)).toEqual([archivedSecond.id, archivedFirst.id]);
    await expect(matches.deleteArchived(active.id, active.version)).rejects.toThrow("Only an archived match");
    await expect(matches.update(archivedFirst.id, { durationMinutes: 120, expectedVersion: archivedFirst.version })).rejects.toThrow("no longer active");

    await expect(matches.deleteArchived(archivedSecond.id, archivedSecond.version)).resolves.toBe(true);
    await expect(matches.getById(archivedSecond.id)).rejects.toThrow("was not found");
    expect((await matches.list({ telegramChatId: CHAT_ID, archived: true })).map((match) => match.id)).toEqual([archivedFirst.id]);
  });

  it("emits once per upward threshold crossing and ignores disabled options", async () => {
    const polls = new TelegramPollsRepository(database.db);
    const poll = await polls.create({
      telegramChatId: CHAT_ID,
      telegramTopicId: 2n,
      question: "Кто играет?",
      options: [
        { text: "Буду", notificationEnabled: true },
        { text: "Не буду", notificationEnabled: false },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });
    const published = await polls.markPublished(poll.id, "telegram-poll-1", 202n, [
      { text: "Буду", voterCount: 0 },
      { text: "Не буду", voterCount: 0 },
    ]);

    const first = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-1");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 10 },
        { text: "Не буду", voterCount: 10 },
      ], false, new Date("2026-08-11T10:00:00.000Z"));
    });
    const repeated = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-1");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 11 },
        { text: "Не буду", voterCount: 5 },
      ], false, new Date("2026-08-11T10:01:00.000Z"));
    });
    const rearmed = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-1");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 9 },
        { text: "Не буду", voterCount: 5 },
      ], false, new Date("2026-08-11T10:02:00.000Z"));
    });
    const reachedAgain = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-1");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 10 },
        { text: "Не буду", voterCount: 10 },
      ], false, new Date("2026-08-11T10:03:00.000Z"));
    });

    expect(published.publicationState).toBe("published");
    expect(first.triggers).toEqual([{ optionIndex: 0, optionText: "Буду", threshold: 10, voterCount: 10 }]);
    expect(first.poll.options[0]?.notificationQueuedAt).toBe("2026-08-11T10:00:00.000Z");
    expect(repeated.triggers).toEqual([]);
    expect(repeated.poll.options.map((option) => option.voterCount)).toEqual([11, 5]);
    expect(repeated.poll.options[1]?.notificationQueuedAt).toBeNull();
    expect(rearmed.triggers).toEqual([]);
    expect(rearmed.poll.options[0]?.notificationQueuedAt).toBeNull();
    expect(reachedAgain.triggers).toEqual([{ optionIndex: 0, optionText: "Буду", threshold: 10, voterCount: 10 }]);
    expect(reachedAgain.poll.options[0]?.notificationQueuedAt).toBe("2026-08-11T10:03:00.000Z");
  });

  it("updates only ordered option notifications and waits for a fresh upward crossing after re-enabling", async () => {
    const polls = new TelegramPollsRepository(database.db);
    const created = await polls.create({
      telegramChatId: CHAT_ID,
      telegramTopicId: 2n,
      question: "Кто играет?",
      options: [
        { text: "Буду", notificationEnabled: true },
        { text: "Не буду", notificationEnabled: true },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });
    await polls.markPublished(created.id, "telegram-poll-notification-settings", 204n, [
      { text: "Буду", voterCount: 0 },
      { text: "Не буду", voterCount: 0 },
    ]);

    const reached = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-notification-settings");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 10 },
        { text: "Не буду", voterCount: 3 },
      ], false);
    });
    expect(reached.triggers).toHaveLength(1);

    const disabled = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByIdForUpdate(created.id);
      return repository.updateNotificationSettings(current, { notificationEnabled: [false, true] });
    });
    expect(disabled).toMatchObject({
      question: "Кто играет?",
      telegramPollId: "telegram-poll-notification-settings",
      telegramMessageId: 204n,
      notificationThreshold: 10,
      options: [
        { text: "Буду", notificationEnabled: false, voterCount: 10 },
        { text: "Не буду", notificationEnabled: true, voterCount: 3 },
      ],
    });

    await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByIdForUpdate(created.id);
      await repository.updateNotificationSettings(current, { notificationEnabled: [true, true] });
    });
    const unchangedAboveThreshold = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-notification-settings");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 10 },
        { text: "Не буду", voterCount: 3 },
      ], false);
    });
    expect(unchangedAboveThreshold.triggers).toEqual([]);

    await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-notification-settings");
      if (current === undefined) throw new Error("Published poll was not found");
      await repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 9 },
        { text: "Не буду", voterCount: 3 },
      ], false);
    });
    const reachedAgain = await database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-notification-settings");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramUpdate(current, [
        { text: "Буду", voterCount: 10 },
        { text: "Не буду", voterCount: 3 },
      ], false);
    });
    expect(reachedAgain.triggers).toEqual([{ optionIndex: 0, optionText: "Буду", threshold: 10, voterCount: 10 }]);

    await polls.archive(created.id);
    await expect(database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      return repository.updateNotificationSettings(await repository.getByIdForUpdate(created.id), { notificationEnabled: [false, false] });
    })).rejects.toThrow("An archived poll cannot be edited");
  });

  it("serializes notification settings with concurrent Telegram count updates", async () => {
    const polls = new TelegramPollsRepository(database.db);
    const created = await polls.create({
      telegramChatId: CHAT_ID,
      telegramTopicId: 2n,
      question: "Параллельный опрос?",
      options: [
        { text: "Да", notificationEnabled: true },
        { text: "Нет", notificationEnabled: true },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });
    await polls.markPublished(created.id, "telegram-poll-concurrency", 205n, [
      { text: "Да", voterCount: 0 },
      { text: "Нет", voterCount: 0 },
    ]);

    await Promise.all([
      database.db.transaction(async (tx) => {
        const repository = new TelegramPollsRepository(tx);
        const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-concurrency");
        if (current === undefined) throw new Error("Published poll was not found");
        await repository.applyTelegramUpdate(current, [
          { text: "Да", voterCount: 10 },
          { text: "Нет", voterCount: 4 },
        ], false);
      }),
      database.db.transaction(async (tx) => {
        const repository = new TelegramPollsRepository(tx);
        const current = await repository.getByIdForUpdate(created.id);
        await repository.updateNotificationSettings(current, { notificationEnabled: [false, true] });
      }),
    ]);

    const stored = await polls.getById(created.id);
    expect(stored.options).toMatchObject([
      { text: "Да", notificationEnabled: false, voterCount: 10 },
      { text: "Нет", notificationEnabled: true, voterCount: 4 },
    ]);
  });

  it("emits a withdrawal alert on each distinct downward threshold crossing", async () => {
    const polls = new TelegramPollsRepository(database.db);
    const poll = await polls.create({
      telegramChatId: CHAT_ID,
      telegramTopicId: 2n,
      question: "Кто играет?",
      options: [
        { text: "Буду", notificationEnabled: true },
        { text: "Не буду", notificationEnabled: false },
      ],
      notificationThreshold: 1,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });
    await polls.markPublished(poll.id, "telegram-poll-withdrawal", 203n, [
      { text: "Буду", voterCount: 0 },
      { text: "Не буду", voterCount: 0 },
    ]);

    const applyAnswer = async (telegramUpdateId: bigint, selectedOptionIndexes: readonly number[]) => database.db.transaction(async (tx) => {
      const repository = new TelegramPollsRepository(tx);
      const current = await repository.getByTelegramPollIdForUpdate("telegram-poll-withdrawal");
      if (current === undefined) throw new Error("Published poll was not found");
      return repository.applyTelegramVoterAnswer(current, {
        telegramUpdateId,
        voterKind: "user",
        telegramVoterId: 800_001n,
        username: "player_one",
        displayName: "Player One",
        selectedOptionIndexes,
      });
    });

    expect((await applyAnswer(100n, [0])).triggers).toEqual([]);
    expect((await applyAnswer(101n, [])).triggers).toEqual([{
      optionIndex: 0,
      optionText: "Буду",
      threshold: 1,
      voterCount: 0,
      username: "player_one",
      displayName: "Player One",
      voterKind: "user",
      telegramVoterId: 800_001n,
    }]);
    expect((await applyAnswer(101n, [])).triggers).toEqual([]);
    expect((await applyAnswer(102n, [0])).triggers).toEqual([]);
    expect((await applyAnswer(103n, [])).triggers).toHaveLength(1);

    await polls.archive(poll.id);
    const retainedAnswers = await database.db.select().from(telegramPollVoterAnswers)
      .where(eq(telegramPollVoterAnswers.pollId, poll.id));
    expect(retainedAnswers).toEqual([]);
  });

  it("isolates archived polls from active polls, orders them newest first, and permits permanent deletion", async () => {
    const polls = new TelegramPollsRepository(database.db);
    const first = await polls.create({
      telegramChatId: CHAT_ID,
      telegramTopicId: 1n,
      question: "Первый архивный?",
      options: [
        { text: "Да", notificationEnabled: true },
        { text: "Нет", notificationEnabled: true },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });
    const second = await polls.create({
      telegramChatId: CHAT_ID,
      telegramTopicId: 1n,
      question: "Второй архивный?",
      options: [
        { text: "Да", notificationEnabled: true },
        { text: "Нет", notificationEnabled: true },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });
    const active = await polls.create({
      telegramChatId: CHAT_ID,
      telegramTopicId: 1n,
      question: "Активный?",
      options: [
        { text: "Да", notificationEnabled: true },
        { text: "Нет", notificationEnabled: true },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });
    await polls.create({
      telegramChatId: CHAT_ID + 1n,
      telegramTopicId: 1n,
      question: "Другой чат?",
      options: [
        { text: "Да", notificationEnabled: true },
        { text: "Нет", notificationEnabled: true },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: OWNER_ID,
    });

    const archivedFirst = await polls.archive(first.id, new Date("2026-08-11T11:00:00.000Z"));
    const archivedSecond = await polls.archive(second.id, new Date("2026-08-11T12:00:00.000Z"));

    expect(archivedFirst.archivedAt).toEqual(new Date("2026-08-11T11:00:00.000Z"));
    expect((await polls.listByChat(CHAT_ID)).map((poll) => poll.id)).toEqual([active.id]);
    expect((await polls.listByChat(CHAT_ID, { archived: true })).map((poll) => poll.id)).toEqual([archivedSecond.id, archivedFirst.id]);
    await expect(polls.deleteArchived(active.id)).rejects.toThrow("Only an archived poll");

    await expect(polls.deleteArchived(archivedSecond.id)).resolves.toBe(true);
    await expect(polls.getById(archivedSecond.id)).rejects.toThrow("was not found");
    expect((await polls.listByChat(CHAT_ID, { archived: true })).map((poll) => poll.id)).toEqual([archivedFirst.id]);
  });
});
