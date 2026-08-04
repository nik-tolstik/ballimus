import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  ExternalParticipantsRepository,
  hashIdempotencyRequest,
  HttpIdempotencyRepository,
  JobClaimsRepository,
  MatchMessagesRepository,
  MatchesRepository,
  NotificationsRepository,
  OutboxRepository,
  PlayersRepository,
  PlayerUsernamesRepository,
  runAliasBindingTransaction,
  runCreateAliasTransaction,
  runLifecycleTransaction,
  runOwnerVoteRemovalTransaction,
  runVoteChangeTransaction,
  TelegramUpdatesRepository,
  VenuesRepository,
  VotesRepository,
  type Match,
  type TelegramIdentityInput,
} from "./index.js";
import {
  createPostgresTestDatabase,
  resetPostgresTestDatabase,
  type PostgresTestDatabase,
} from "./test-support/postgres.js";

const TEST_TIMEOUT_MS = 30_000;
const CHAT_ID = -100_700_001n;
const CHAT_TOPIC_ID = 2n;
const OWNER_ID = 700_001n;
const MATCH_TIME = new Date("2026-08-02T17:00:00.000Z");

let database: PostgresTestDatabase;

function timestamp(offsetMinutes = 0): Date {
  return new Date(Date.UTC(2026, 7, 1, 12, offsetMinutes, 0));
}

function identity(
  telegramUserId: bigint,
  username: string | null,
  firstName: string,
  lastName = "Tester",
): TelegramIdentityInput {
  return {
    telegramUserId,
    username,
    firstName,
    lastName,
    languageCode: "en",
    seenAt: timestamp(Number(telegramUserId % 20n)),
  };
}

async function createActiveMatch(requiredPlayers: number): Promise<Match> {
  return new MatchesRepository(database.db).create({
    telegramChatId: CHAT_ID,
    scheduledAt: MATCH_TIME,
    location: "Local test field",
    venueType: "outdoor",
    fieldPriceRubles: 100,
    title: "Local integration match",
    requiredPlayers,
    creatorTelegramUserId: OWNER_ID,
    status: "active",
    createdAt: timestamp(1),
  });
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`Unexpected test identifier: ${value}`);
  return `"${value}"`;
}

describe("PostgreSQL baseline migration and repositories", () => {
  beforeAll(async () => {
    database = await createPostgresTestDatabase();
  }, TEST_TIMEOUT_MS);

  beforeEach(async () => {
    await resetPostgresTestDatabase(database);
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, TEST_TIMEOUT_MS);

  it("applies a fresh baseline with the required tables, constraints, indexes, and triggers", async () => {
    const tableRows = await database.sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = ${database.schemaName}
        and table_type = 'BASE TABLE'
      order by table_name
    `;
    expect(tableRows.map((row) => row.table_name)).toEqual([
      "external_participants",
      "http_idempotency_keys",
      "job_claims",
      "match_messages",
      "matches",
      "notifications",
      "outbox",
      "player_usernames",
      "players",
      "telegram_updates",
      "venues",
      "votes",
    ]);

    const migrationRows = await database.sql.unsafe<{ hash: string; created_at: string }[]>(
      `select hash, created_at from ${quoteIdentifier(database.migrationSchemaName)}."__drizzle_migrations"`,
    );
    expect(migrationRows).toHaveLength(10);
    expect(migrationRows[0]?.hash).toMatch(/^[a-f0-9]{64}$/u);

    const constraintRows = await database.sql<{ conname: string }[]>`
      select constraint_name as conname
      from information_schema.table_constraints
      where table_schema = ${database.schemaName}
    `;
    const constraints = new Set(constraintRows.map((row) => row.conname));
    for (const name of [
      "matches_required_players_positive",
      "matches_status_valid",
      "matches_time_configuration_consistent",
      "matches_cancellation_state_consistent",
      "players_avatar_cache_consistent",
      "external_participants_quantity_is_one",
      "external_participants_available_after_valid",
      "match_messages_match_chat_fk",
      "votes_source_update_consistent",
      "votes_available_after_option_consistent",
      "votes_match_player_pk",
      "job_claims_lease_after_claim",
      "outbox_deduplication_key_unique",
      "matches_venue_id_venues_id_fk",
    ]) {
      expect(constraints, `missing constraint ${name}`).toContain(name);
    }

    const indexRows = await database.sql<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = ${database.schemaName}
    `;
    const indexes = new Set(indexRows.map((row) => row.indexname));
    for (const name of [
      "players_telegram_user_id_unique",
      "matches_chat_status_idx",
      "matches_scheduled_at_idx",
      "match_messages_telegram_reference_unique",
      "votes_match_telegram_user_unique",
      "votes_match_option_idx",
      "external_participants_source_update_unique",
      "http_idempotency_expiry_idx",
      "notifications_match_type_transition_unique",
      "notifications_weather_day_unique",
      "outbox_delivery_queue_idx",
      "venues_archived_at_idx",
      "venues_name_ci_unique",
      "matches_venue_id_idx",
    ]) {
      expect(indexes, `missing index ${name}`).toContain(name);
    }

    const triggerRows = await database.sql<{ tgname: string }[]>`
      select trigger_name as tgname
      from information_schema.triggers
      where event_object_schema = ${database.schemaName}
    `;
    const triggers = new Set(triggerRows.map((row) => row.tgname));
    expect(triggers).toContain("player_usernames_no_silent_rebinding");
    expect(triggers).toContain("matches_set_updated_at");
  }, TEST_TIMEOUT_MS);

  it("archives and restores venues while keeping linked match details synchronized", async () => {
    const venueRepository = new VenuesRepository(database.db);
    const matchRepository = new MatchesRepository(database.db);
    const venue = await venueRepository.create({
      name: "BOX365 Октябрьская",
      mapUrl: "https://maps.example.test/box365-oct",
      venueType: "indoor",
      bookingContacts: [{ name: "Администратор", phone: "+375 29 123-45-67" }],
      websiteUrl: "https://box365.example.test",
      createdAt: timestamp(4),
    });
    expect(venue.bookingContacts).toEqual([{ name: "Администратор", phone: "+375 29 123-45-67" }]);

    await expect(venueRepository.update(venue.id, {
      bookingContacts: [{ phone: "+375 29 123-45-67" }, { phone: "+375 29 123-45-67" }],
      expectedVersion: venue.version,
    })).rejects.toThrow("bookingContacts must not contain duplicate phones");

    await expect(venueRepository.create({
      name: "box365 октябрьская",
      mapUrl: "https://maps.example.test/duplicate",
      venueType: "indoor",
    })).rejects.toThrow();

    const match = await matchRepository.create({
      telegramChatId: CHAT_ID,
      scheduledAt: MATCH_TIME,
      location: venue.name,
      venueType: venue.venueType,
      venueId: venue.id,
      title: "Local integration match",
      requiredPlayers: 10,
      creatorTelegramUserId: OWNER_ID,
      status: "active",
      createdAt: timestamp(5),
    });
    expect((await matchRepository.list({ venueId: venue.id })).map((record) => record.id)).toEqual([match.id]);

    const updatedVenue = await venueRepository.update(venue.id, {
      name: "BOX365 Пушкинская",
      expectedVersion: venue.version,
      now: timestamp(6),
    });
    const syncedMatch = await matchRepository.syncVenueDetails(match.id, {
      venueId: venue.id,
      location: updatedVenue.name,
      venueType: updatedVenue.venueType,
      title: "Local integration match — BOX365 Пушкинская",
      now: timestamp(7),
    });
    expect(syncedMatch).toMatchObject({
      venueId: venue.id,
      location: "BOX365 Пушкинская",
      venueType: "indoor",
      version: 2,
    });

    const archived = await venueRepository.setArchived(venue.id, true, updatedVenue.version);
    expect(archived.archivedAt).not.toBeNull();
    expect(await venueRepository.list()).toEqual([]);
    expect((await venueRepository.list({ includeArchived: true })).map((record) => record.id)).toEqual([venue.id]);

    const restored = await venueRepository.setArchived(venue.id, false, archived.version);
    expect(restored.archivedAt).toBeNull();
    expect((await venueRepository.list()).map((record) => record.id)).toEqual([venue.id]);
  }, TEST_TIMEOUT_MS);

  it("stores a bounded player avatar cache and records a checked missing photo", async () => {
    const players = new PlayersRepository(database.db);
    await players.create({ telegramUserId: 19_001n, displayName: "Avatar Player" });
    const image = Buffer.from("small-avatar").toString("base64");

    const cached = await players.updateAvatarCache(19_001n, {
      fileUniqueId: "telegram-file-1",
      contentType: "image/jpeg",
      dataBase64: image,
    }, timestamp(2));
    expect(cached).toMatchObject({
      avatarFileUniqueId: "telegram-file-1",
      avatarContentType: "image/jpeg",
      avatarDataBase64: image,
      avatarRefreshedAt: timestamp(2),
    });

    const missing = await players.updateAvatarCache(19_001n, {
      fileUniqueId: null,
      contentType: null,
      dataBase64: null,
    }, timestamp(3));
    expect(missing).toMatchObject({
      avatarFileUniqueId: null,
      avatarContentType: null,
      avatarDataBase64: null,
      avatarRefreshedAt: timestamp(3),
    });
  }, TEST_TIMEOUT_MS);

  it("serializes concurrent Telegram votes into one current vote per player with correct going counts", async () => {
    const match = await createActiveMatch(2);
    const votes = new VotesRepository(database.db);

    const results = await Promise.all([
      runVoteChangeTransaction(database.db, {
        updateId: 10_001n,
        matchId: match.id,
        identity: identity(20_001n, "repeat_player", "Repeat"),
        option: "going",
      }),
      runVoteChangeTransaction(database.db, {
        updateId: 10_002n,
        matchId: match.id,
        identity: identity(20_001n, "repeat_player", "Repeat"),
        option: "going",
      }),
      runVoteChangeTransaction(database.db, {
        updateId: 10_003n,
        matchId: match.id,
        identity: identity(20_002n, "second_player", "Second"),
        option: "going",
      }),
      runVoteChangeTransaction(database.db, {
        updateId: 10_004n,
        matchId: match.id,
        identity: identity(20_003n, "third_player", "Third"),
        option: "not_going",
      }),
    ]);

    expect(results.every((result) => result.status === "applied")).toBe(true);
    const currentVotes = await votes.listByMatchId(match.id);
    expect(currentVotes).toHaveLength(3);
    expect(new Set(currentVotes.map((vote) => vote.telegramUserId))).toEqual(
      new Set([20_001n, 20_002n, 20_003n]),
    );
    expect(await votes.countGoing(match.id)).toBe(2);
    expect(await votes.rosterCounts(match.id)).toMatchObject({
      goingVotes: 2,
      externalParticipants: 0,
      goingCount: 2,
      requiredPlayers: 2,
      thresholdReached: true,
      remainingToThreshold: 0,
    });
    for (const updateId of [10_001n, 10_002n, 10_003n, 10_004n]) {
      expect((await new TelegramUpdatesRepository(database.db).findByUpdateId(updateId))?.status).toBe(
        "processed",
      );
    }
  }, TEST_TIMEOUT_MS);

  it("stores a match with one after-time availability option", async () => {
    const match = await new MatchesRepository(database.db).create({
      telegramChatId: CHAT_ID,
      scheduledAt: null,
      scheduleDate: "2026-08-02",
      timeMode: "availability",
      timeOptions: ["19:00"],
      location: "Local flexible field",
      requiredPlayers: 2,
      creatorTelegramUserId: OWNER_ID,
      status: "active",
    });

    expect(match).toMatchObject({ timeMode: "availability", timeOptions: ["19:00"] });

    const exactOptionsMatch = await new MatchesRepository(database.db).create({
      telegramChatId: CHAT_ID,
      scheduledAt: null,
      scheduleDate: "2026-08-03",
      timeMode: "exact_options",
      timeOptions: ["19:00", "20:00"],
      location: "Exact options field",
      requiredPlayers: 2,
      creatorTelegramUserId: OWNER_ID,
      status: "active",
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_091n,
      matchId: exactOptionsMatch.id,
      identity: identity(20_091n, "exact_early_one", "Early one"),
      option: "going",
      availableAfter: "19:00",
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_094n,
      matchId: exactOptionsMatch.id,
      identity: identity(20_091n, "exact_early_one", "Early one"),
      option: "going",
      availableAfter: "20:00",
    });
    expect(await new VotesRepository(database.db).find(exactOptionsMatch.id, 20_091n)).toMatchObject({
      availableAfter: null,
      exactTimes: ["19:00", "20:00"],
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_092n,
      matchId: exactOptionsMatch.id,
      identity: identity(20_092n, "exact_early_two", "Early two"),
      option: "going",
      availableAfter: "19:00",
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_093n,
      matchId: exactOptionsMatch.id,
      identity: identity(20_093n, "exact_late", "Late"),
      option: "going",
      availableAfter: "20:00",
    });
    const exactCounts = new VotesRepository(database.db);
    expect(await exactCounts.rosterCounts(exactOptionsMatch.id)).toMatchObject({ goingVotes: 2, thresholdReached: true });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_095n,
      matchId: exactOptionsMatch.id,
      identity: identity(20_091n, "exact_early_one", "Early one"),
      option: "going",
      availableAfter: "19:00",
    });
    expect(await exactCounts.find(exactOptionsMatch.id, 20_091n)).toMatchObject({ exactTimes: ["20:00"] });
    const removed = await runVoteChangeTransaction(database.db, {
      updateId: 10_096n,
      matchId: exactOptionsMatch.id,
      identity: identity(20_091n, "exact_early_one", "Early one"),
      option: "going",
      availableAfter: "20:00",
    });
    expect(removed.status).toBe("removed");
    expect(await exactCounts.find(exactOptionsMatch.id, 20_091n)).toBeUndefined();
    expect(await exactCounts.rosterCounts(exactOptionsMatch.id)).toMatchObject({ goingVotes: 1, thresholdReached: false });
    await new MatchesRepository(database.db).transitionStatus(exactOptionsMatch.id, {
      to: "confirmed",
      scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
      selectedTime: "20:00",
    });
    expect(await exactCounts.rosterCounts(exactOptionsMatch.id)).toMatchObject({ goingVotes: 1, thresholdReached: false });
    await expect(runVoteChangeTransaction(database.db, {
      updateId: 10_097n,
      matchId: exactOptionsMatch.id,
      identity: identity(20_097n, "confirmed_exact_player", "Confirmed exact"),
      option: "going",
    })).resolves.toMatchObject({ status: "applied" });
    expect(await exactCounts.find(exactOptionsMatch.id, 20_097n)).toMatchObject({
      availableAfter: null,
      exactTimes: ["20:00"],
    });
    expect(await exactCounts.rosterCounts(exactOptionsMatch.id)).toMatchObject({ goingVotes: 2, thresholdReached: true });
  }, TEST_TIMEOUT_MS);

  it("stores availability votes and counts only players eligible for the confirmed time", async () => {
    const match = await new MatchesRepository(database.db).create({
      telegramChatId: CHAT_ID,
      scheduledAt: null,
      scheduleDate: "2026-08-02",
      timeMode: "availability",
      timeOptions: ["19:00", "20:00"],
      location: "Local flexible field",
      requiredPlayers: 2,
      creatorTelegramUserId: OWNER_ID,
      status: "active",
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_101n,
      matchId: match.id,
      identity: identity(20_101n, "early_player", "Early"),
      option: "going",
      availableAfter: "19:00",
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_102n,
      matchId: match.id,
      identity: identity(20_102n, "late_player", "Late"),
      option: "going",
      availableAfter: "20:00",
    });
    const votes = new VotesRepository(database.db);
    const externalParticipants = new ExternalParticipantsRepository(database.db);
    await externalParticipants.addQuantity({
      matchId: match.id,
      ownerTelegramUserId: OWNER_ID,
      displayName: "Ромы",
      availableAfter: "19:00",
      quantity: 1,
    });
    await externalParticipants.addQuantity({
      matchId: match.id,
      ownerTelegramUserId: OWNER_ID,
      displayName: "Поздний гость",
      availableAfter: "20:00",
      quantity: 1,
    });
    await externalParticipants.addQuantity({
      matchId: match.id,
      ownerTelegramUserId: OWNER_ID,
      displayName: "Время неизвестно",
      quantity: 1,
    });
    expect(await externalParticipants.listByMatchId(match.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Ромы", availableAfter: "19:00" }),
      expect.objectContaining({ displayName: "Поздний гость", availableAfter: "20:00" }),
      expect.objectContaining({ displayName: "Время неизвестно", availableAfter: null }),
    ]));
    expect(await votes.rosterCounts(match.id)).toMatchObject({ goingVotes: 2, externalParticipants: 3, goingCount: 5, thresholdReached: true });

    await expect(runVoteChangeTransaction(database.db, {
      updateId: 10_103n,
      matchId: match.id,
      identity: identity(20_103n, "unconfirmed_player", "Unconfirmed"),
      option: "going",
    })).rejects.toThrow("availableAfter must be one of the match time options");

    await new MatchesRepository(database.db).transitionStatus(match.id, {
      to: "confirmed",
      scheduledAt: MATCH_TIME,
      selectedTime: "19:00",
    });
    expect(await votes.rosterCounts(match.id)).toMatchObject({
      goingVotes: 1,
      externalParticipants: 1,
      goingCount: 2,
      thresholdReached: true,
      remainingToThreshold: 0,
    });
    await expect(runVoteChangeTransaction(database.db, {
      updateId: 10_104n,
      matchId: match.id,
      identity: identity(20_104n, "confirmed_player", "Confirmed"),
      option: "going",
    })).resolves.toMatchObject({ status: "applied" });
    expect(await votes.find(match.id, 20_104n)).toMatchObject({
      availableAfter: "19:00",
      exactTimes: [],
    });
    expect(await votes.rosterCounts(match.id)).toMatchObject({
      goingVotes: 2,
      externalParticipants: 1,
      goingCount: 3,
      thresholdReached: true,
      remainingToThreshold: 0,
    });
  }, TEST_TIMEOUT_MS);

  it("keeps going votes when their poll-specific time selections are cleared", async () => {
    const match = await new MatchesRepository(database.db).create({
      telegramChatId: CHAT_ID,
      scheduledAt: null,
      scheduleDate: "2026-08-02",
      timeMode: "availability",
      timeOptions: ["20:00"],
      location: "Local flexible field",
      requiredPlayers: 2,
      creatorTelegramUserId: OWNER_ID,
      status: "active",
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_111n,
      matchId: match.id,
      identity: identity(20_111n, "fixed_time_player", "Fixed time"),
      option: "going",
      availableAfter: "20:00",
    });
    await runVoteChangeTransaction(database.db, {
      updateId: 10_112n,
      matchId: match.id,
      identity: identity(20_112n, "maybe_player", "Maybe"),
      option: "maybe",
    });

    const votes = new VotesRepository(database.db);
    const cleared = await votes.clearGoingTimeSelections(match.id, timestamp(10));

    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({
      telegramUserId: 20_111n,
      option: "going",
      availableAfter: null,
      exactTimes: [],
    });
    expect(await votes.listByMatchId(match.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ telegramUserId: 20_111n, option: "going" }),
      expect.objectContaining({ telegramUserId: 20_112n, option: "maybe" }),
    ]));
    expect(await votes.rosterCounts(match.id)).toMatchObject({ goingVotes: 1, goingCount: 1 });
  }, TEST_TIMEOUT_MS);

  it("binds a normalized pre-created alias once, tracks username changes, and keeps no-username identity stable", async () => {
    const match = await createActiveMatch(5);
    const players = new PlayersRepository(database.db);
    const aliases = new PlayerUsernamesRepository(database.db);

    const preCreated = await runCreateAliasTransaction(database.db, {
      username: "@Future_Player",
      displayName: "Pre-created Player",
      seenAt: timestamp(2),
    });
    expect(preCreated.player.telegramUserId).toBeNull();
    expect(preCreated.username.normalizedUsername).toBe("future_player");

    const firstVote = await runVoteChangeTransaction(database.db, {
      updateId: 11_001n,
      matchId: match.id,
      identity: identity(21_001n, "@Future_Player", "Telegram", "Person"),
      option: "going",
    });
    expect(firstVote.status).toBe("applied");
    if (firstVote.status !== "applied") throw new Error("expected the first vote to apply");
    expect(firstVote.playerId).toBe(preCreated.player.id);
    expect((await players.getById(firstVote.playerId)).telegramUserId).toBe(21_001n);

    const replay = await runVoteChangeTransaction(database.db, {
      updateId: 11_001n,
      matchId: match.id,
      identity: identity(21_001n, "future_player", "Changed", "Replay"),
      option: "not_going",
    });
    expect(replay).toMatchObject({ status: "duplicate", updateId: 11_001n });

    const changedUsername = await runVoteChangeTransaction(database.db, {
      updateId: 11_002n,
      matchId: match.id,
      identity: identity(21_001n, "New_Handle", "Telegram", "Person"),
      option: "maybe",
    });
    expect(changedUsername.status).toBe("applied");
    if (changedUsername.status !== "applied") throw new Error("expected the username change vote to apply");
    expect(changedUsername.playerId).toBe(preCreated.player.id);
    expect((await players.getById(preCreated.player.id)).telegramUsernameSnapshot).toBe("new_handle");
    expect((await aliases.findByUsername("@FUTURE_PLAYER"))?.playerId).toBe(preCreated.player.id);
    expect((await aliases.findByUsername("new_handle"))?.playerId).toBe(preCreated.player.id);
    expect(await aliases.findByPlayerId(preCreated.player.id)).toHaveLength(2);

    const noUsernameVote = await runVoteChangeTransaction(database.db, {
      updateId: 11_003n,
      matchId: match.id,
      identity: identity(21_002n, null, "No", "Username"),
      option: "going",
    });
    expect(noUsernameVote.status).toBe("applied");
    if (noUsernameVote.status !== "applied") throw new Error("expected the no-username vote to apply");
    const noUsernamePlayer = await players.getById(noUsernameVote.playerId);
    expect(noUsernamePlayer.telegramUserId).toBe(21_002n);
    expect(noUsernamePlayer.displayName).toBe("No Username");
    expect(await aliases.findByPlayerId(noUsernamePlayer.id)).toHaveLength(0);

    await players.updateDisplayName(noUsernamePlayer.id, "Renamed No Username", timestamp(4));
    const noUsernameFollowUp = await runVoteChangeTransaction(database.db, {
      updateId: 11_004n,
      matchId: match.id,
      identity: identity(21_002n, null, "Updated", "Telegram"),
      option: "maybe",
    });
    expect(noUsernameFollowUp.status).toBe("applied");
    if (noUsernameFollowUp.status !== "applied") throw new Error("expected the follow-up vote to apply");
    expect(noUsernameFollowUp.playerId).toBe(noUsernamePlayer.id);
    expect(noUsernameFollowUp.vote?.displayNameSnapshot).toBe("Renamed No Username");
  }, TEST_TIMEOUT_MS);

  it("rejects conflicting Telegram and normalized username bindings without rebinding either identity", async () => {
    const firstAlias = await runCreateAliasTransaction(database.db, {
      username: "Conflict_Name",
      displayName: "First Player",
      seenAt: timestamp(1),
    });
    const secondAlias = await runCreateAliasTransaction(database.db, {
      username: "Second_Name",
      displayName: "Second Player",
      seenAt: timestamp(2),
    });

    const firstBinding = await runAliasBindingTransaction(database.db, {
      telegramUserId: 22_001n,
      username: "conflict_name",
      firstName: "First",
      lastName: "Telegram",
      seenAt: timestamp(3),
    });
    expect(firstBinding.player.id).toBe(firstAlias.player.id);
    expect(firstBinding.wasBound).toBe(true);

    await expect(
      runAliasBindingTransaction(database.db, {
        telegramUserId: 22_002n,
        username: "@CONFLICT_NAME",
        firstName: "Other",
        lastName: "Telegram",
        seenAt: timestamp(4),
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(
      runAliasBindingTransaction(database.db, {
        telegramUserId: 22_001n,
        username: secondAlias.username.normalizedUsername,
        firstName: "First",
        lastName: "Moved",
        seenAt: timestamp(5),
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    expect((await new PlayersRepository(database.db).getById(firstAlias.player.id)).telegramUserId).toBe(22_001n);
    expect((await new PlayersRepository(database.db).getById(secondAlias.player.id)).telegramUserId).toBeNull();
    expect((await new PlayerUsernamesRepository(database.db).findByUsername("conflict_name"))?.playerId).toBe(
      firstAlias.player.id,
    );
    expect((await new PlayerUsernamesRepository(database.db).findByUsername("second_name"))?.playerId).toBe(
      secondAlias.player.id,
    );
  }, TEST_TIMEOUT_MS);

  it("treats a Telegram update id as globally unique across matches and prevents replayed business changes", async () => {
    const firstMatch = await createActiveMatch(1);
    const secondMatch = await createActiveMatch(1);
    const updates = new TelegramUpdatesRepository(database.db);
    const first = await runVoteChangeTransaction(database.db, {
      updateId: 12_001n,
      matchId: firstMatch.id,
      identity: identity(23_001n, "global_user", "Global"),
      option: "going",
    });
    expect(first.status).toBe("applied");

    const replay = await runVoteChangeTransaction(database.db, {
      updateId: 12_001n,
      matchId: secondMatch.id,
      identity: identity(23_002n, "different_user", "Different"),
      option: "going",
    });
    expect(replay).toMatchObject({ status: "duplicate", updateId: 12_001n });
    expect(await new VotesRepository(database.db).listByMatchId(firstMatch.id)).toHaveLength(1);
    expect(await new VotesRepository(database.db).listByMatchId(secondMatch.id)).toHaveLength(0);
    expect(await updates.findByUpdateId(12_001n)).toMatchObject({ status: "processed", attemptCount: 1 });
  }, TEST_TIMEOUT_MS);

  it("creates individually editable external players and reports one threshold transition", async () => {
    const match = await createActiveMatch(3);
    const repository = new ExternalParticipantsRepository(database.db);
    const added = await repository.addQuantity({
      matchId: match.id,
      ownerTelegramUserId: OWNER_ID,
      displayName: "Guests",
      quantity: 3,
      createdAt: timestamp(1),
    });
    expect(added).toMatchObject({ status: "added", thresholdReached: true });
    expect(added.entries).toMatchObject([
      { displayName: "Guests #1", quantity: 1 },
      { displayName: "Guests #2", quantity: 1 },
      { displayName: "Guests #3", quantity: 1 },
    ]);
    const originalId = added.entry?.id;
    expect(originalId).toBeDefined();

    const updated = await repository.update({
      id: originalId as bigint,
      ownerTelegramUserId: OWNER_ID,
      displayName: "Visitors",
      now: timestamp(2),
    });
    expect(updated).toMatchObject({
      status: "updated",
      thresholdReached: false,
      thresholdLost: false,
      entry: { id: originalId, displayName: "Visitors", quantity: 1 },
    });
    expect(await repository.listByMatchId(match.id)).toHaveLength(3);

    const removed = await repository.remove({
      id: originalId as bigint,
      ownerTelegramUserId: OWNER_ID,
      now: timestamp(3),
    });
    expect(removed).toMatchObject({ status: "removed", thresholdLost: true });
    expect(await repository.listByMatchId(match.id)).toMatchObject([
      { displayName: "Guests #2", quantity: 1 },
      { displayName: "Guests #3", quantity: 1 },
    ]);
  }, TEST_TIMEOUT_MS);

  it("replays a completed HTTP idempotency response and conflicts on a different request hash", async () => {
    const repository = new HttpIdempotencyRepository(database.db);
    const now = timestamp(1);
    const request = { action: "create-match", requiredPlayers: 8, scheduledAt: MATCH_TIME };
    const requestHash = hashIdempotencyRequest(request);
    const started = await repository.begin({
      ownerTelegramUserId: OWNER_ID,
      idempotencyKey: "http-replay-1",
      requestHash,
      expiresAt: timestamp(120),
      now,
    });
    expect(started.status).toBe("started");
    if (started.status !== "started") throw new Error("expected a new idempotency key");

    const completed = await repository.complete(
      started.record.id,
      { status: 201, body: { matchId: 42n, accepted: true } },
      timestamp(2),
    );
    expect(completed.status).toBe("succeeded");
    expect(completed.responseBody).toEqual({ matchId: "42", accepted: true });

    const replay = await repository.begin({
      ownerTelegramUserId: OWNER_ID,
      idempotencyKey: "http-replay-1",
      requestHash,
      expiresAt: timestamp(120),
      now: timestamp(3),
    });
    expect(replay.status).toBe("replay");
    expect(replay.record.id).toBe(started.record.id);
    expect(replay.record.responseStatus).toBe(201);
    expect(replay.record.responseBody).toEqual({ matchId: "42", accepted: true });

    await expect(
      repository.begin({
        ownerTelegramUserId: OWNER_ID,
        idempotencyKey: "http-replay-1",
        requestHash: hashIdempotencyRequest({ ...request, requiredPlayers: 9 }),
        expiresAt: timestamp(120),
        now: timestamp(3),
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  }, TEST_TIMEOUT_MS);

  it("claims threshold and lifecycle notifications with transactionally inserted, deduplicated outbox rows", async () => {
    const match = await createActiveMatch(1);
    const notifications = new NotificationsRepository(database.db);
    const outbox = new OutboxRepository(database.db);

    const reached = await runVoteChangeTransaction(
      database.db,
      {
        updateId: 13_001n,
        matchId: match.id,
        identity: identity(24_001n, "threshold_user", "Threshold"),
        option: "going",
      },
      {
        outbox: async (result, repositories) => {
          if (result.status !== "applied" || !result.thresholdReached) return [];
          const claim = await repositories.notifications.claimInTransaction({
            matchId: result.match.id,
            notificationType: "threshold_reached",
            transitionKey: "threshold:reached:vote-1",
            payload: { goingCount: result.countsAfter.goingCount },
            claimedAt: timestamp(10),
          });
          return [
            {
              eventType: "send_notification",
              deduplicationKey: "notification:threshold:vote-1",
              notificationId: claim.notification.id,
              telegramChatId: result.match.telegramChatId,
              telegramTopicId: CHAT_TOPIC_ID,
              payload: { notificationId: claim.notification.id },
            },
            {
              eventType: "refresh_public_card",
              deduplicationKey: "card:refresh:vote-1",
              matchId: result.match.id,
              telegramChatId: result.match.telegramChatId,
              telegramTopicId: CHAT_TOPIC_ID,
            },
          ];
        },
      },
    );
    expect(reached.status).toBe("applied");
    expect(reached).toMatchObject({ thresholdReached: true });
    const thresholdNotification = await notifications.find(
      match.id,
      "threshold_reached",
      "threshold:reached:vote-1",
    );
    expect(thresholdNotification).toBeDefined();
    expect(await outbox.findByDeduplicationKey("card:refresh:vote-1")).toMatchObject({
      deliveryState: "pending",
      matchId: match.id,
    });

    const duplicateNotification = await notifications.claim({
      matchId: match.id,
      notificationType: "threshold_reached",
      transitionKey: "threshold:reached:vote-1",
    });
    expect(duplicateNotification.status).toBe("duplicate");
    const duplicateEvent = await outbox.insert({
      eventType: "refresh_public_card",
      deduplicationKey: "card:refresh:vote-1",
      matchId: match.id,
      telegramChatId: CHAT_ID,
      telegramTopicId: CHAT_TOPIC_ID,
    });
    expect(duplicateEvent.status).toBe("duplicate");

    const removed = await runOwnerVoteRemovalTransaction(
      database.db,
      {
        matchId: match.id,
        ownerTelegramUserId: OWNER_ID,
        telegramUserId: 24_001n,
        updatedAt: timestamp(11),
      },
      {
        outbox: async (result, repositories) => {
          if (!result.thresholdLost) return [];
          const claim = await repositories.notifications.claimInTransaction({
            matchId: result.match.id,
            notificationType: "threshold_lost",
            transitionKey: "threshold:lost:remove-1",
            claimedAt: timestamp(12),
          });
          return [{
            eventType: "send_notification",
            deduplicationKey: "notification:threshold:lost-1",
            notificationId: claim.notification.id,
            telegramChatId: result.match.telegramChatId,
            telegramTopicId: CHAT_TOPIC_ID,
          }];
        },
      },
    );
    expect(removed).toMatchObject({ status: "removed", thresholdLost: true });

    const confirmed = await runLifecycleTransaction(
      database.db,
      match.id,
      { to: "confirmed", expectedVersion: match.version, now: timestamp(13) },
      {
        outbox: async (result, repositories) => {
          const claim = await repositories.notifications.claimInTransaction({
            matchId: result.id,
            notificationType: "match_confirmed",
            transitionKey: "status:confirmed",
            claimedAt: timestamp(14),
          });
          return [{
            eventType: "send_notification",
            deduplicationKey: "notification:lifecycle:confirmed",
            notificationId: claim.notification.id,
            telegramChatId: result.telegramChatId,
            telegramTopicId: CHAT_TOPIC_ID,
          }];
        },
      },
    );
    expect(confirmed.status).toBe("confirmed");

    const cancelled = await runLifecycleTransaction(
      database.db,
      match.id,
      { to: "cancelled", expectedVersion: confirmed.version, cancellationReason: "Rain", now: timestamp(15) },
      {
        outbox: async (result, repositories) => {
          const claim = await repositories.notifications.claimInTransaction({
            matchId: result.id,
            notificationType: "match_cancelled",
            transitionKey: "status:cancelled",
            claimedAt: timestamp(16),
          });
          return [
            {
              eventType: "send_notification",
              deduplicationKey: "notification:lifecycle:cancelled",
              notificationId: claim.notification.id,
              telegramChatId: result.telegramChatId,
              telegramTopicId: CHAT_TOPIC_ID,
            },
            {
              eventType: "delete_public_card",
              deduplicationKey: "card:delete:lifecycle:cancelled",
              matchId: result.id,
              telegramChatId: result.telegramChatId,
              telegramTopicId: CHAT_TOPIC_ID,
            },
          ];
        },
      },
    );
    expect(cancelled.status).toBe("cancelled");
    expect(new Set((await notifications.listByMatchId(match.id)).map((row) => row.notificationType))).toEqual(
      new Set(["threshold_reached", "threshold_lost", "match_confirmed", "match_cancelled"]),
    );
    const pendingOutbox = await outbox.listPending();
    expect(pendingOutbox).toHaveLength(6);
    expect(pendingOutbox.filter((event) => event.matchId === match.id)).toHaveLength(2);
    expect(
      pendingOutbox.filter((event) => event.notificationId !== null && event.matchId === null),
    ).toHaveLength(4);

    const rollbackMatch = await createActiveMatch(1);
    await expect(
      runLifecycleTransaction(
        database.db,
        rollbackMatch.id,
        { to: "confirmed", expectedVersion: rollbackMatch.version, now: timestamp(20) },
        {
          outbox: [{
            eventType: "send_notification",
            deduplicationKey: "invalid-transactional-event",
            telegramChatId: CHAT_ID,
            telegramTopicId: CHAT_TOPIC_ID,
          }],
        },
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect((await new MatchesRepository(database.db).getById(rollbackMatch.id)).status).toBe("active");
    expect(await notifications.listByMatchId(rollbackMatch.id)).toHaveLength(0);
    expect(await outbox.findByDeduplicationKey("invalid-transactional-event")).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it("moves notification, uncertain publication, and outbox deliveries through retry-safe states", async () => {
    const match = await createActiveMatch(1);
    const notifications = new NotificationsRepository(database.db);
    const notificationClaim = await notifications.claim({
      matchId: match.id,
      notificationType: "threshold_reached",
      transitionKey: "retry:notification:1",
      claimedAt: timestamp(1),
    });
    expect(notificationClaim.status).toBe("claimed");
    if (notificationClaim.status !== "claimed") throw new Error("expected a notification claim");
    const uncertainNotification = await notifications.markUncertain(
      notificationClaim.notification.id,
      "Telegram outcome was uncertain",
      timestamp(2),
    );
    expect(uncertainNotification.deliveryState).toBe("uncertain");
    const pendingNotification = await notifications.resetForRetry(notificationClaim.notification.id, timestamp(3));
    expect(pendingNotification.deliveryState).toBe("pending");
    expect((await notifications.markSent(notificationClaim.notification.id, timestamp(4))).deliveryState).toBe("sent");

    const messages = new MatchMessagesRepository(database.db);
    const pendingMessage = await messages.createPending(match.id, CHAT_ID, CHAT_TOPIC_ID);
    expect(pendingMessage.publicationState).toBe("pending");
    const uncertainMessage = await messages.markUncertain(
      match.id,
      "Telegram send may have succeeded",
      timestamp(5),
    );
    expect(uncertainMessage.publicationState).toBe("uncertain");
    expect(await messages.listReconciliationCandidates()).toEqual([uncertainMessage]);
    const retriedMessage = await messages.resetForRetry(match.id, timestamp(6));
    expect(retriedMessage).toMatchObject({
      publicationState: "pending",
      telegramMessageId: null,
      publicationAttemptedAt: null,
      publicationUncertainAt: null,
      lastError: null,
    });
    await messages.markUncertain(match.id, "Telegram send may have succeeded again", timestamp(7));
    const publishedMessage = await messages.markPublished(match.id, 55_001n, timestamp(8));
    expect(publishedMessage).toMatchObject({ publicationState: "published", telegramMessageId: 55_001n });

    const outbox = new OutboxRepository(database.db);
    const inserted = await outbox.insert({
      eventType: "reconcile_public_card",
      deduplicationKey: "retry:outbox:1",
      matchId: match.id,
      telegramChatId: CHAT_ID,
      telegramTopicId: CHAT_TOPIC_ID,
      createdAt: timestamp(7),
      availableAt: timestamp(7),
    });
    expect(inserted.status).toBe("inserted");
    if (inserted.status !== "inserted") throw new Error("expected an outbox event");

    const firstClaim = await outbox.claim({ now: timestamp(8), leaseDurationMs: 1_000 });
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]).toMatchObject({ deliveryState: "processing", attemptCount: 1 });
    const uncertainEvent = await outbox.markUncertain(inserted.event.id, "Telegram publication uncertain", timestamp(9));
    expect(uncertainEvent.deliveryState).toBe("uncertain");
    expect(await outbox.listUncertain()).toEqual([uncertainEvent]);

    const retriedEvent = await outbox.retry(inserted.event.id, timestamp(10));
    expect(retriedEvent).toMatchObject({ deliveryState: "pending", availableAt: timestamp(10) });
    const secondClaim = await outbox.claim({ now: timestamp(11), leaseDurationMs: 1_000 });
    expect(secondClaim[0]).toMatchObject({ deliveryState: "processing", attemptCount: 2 });
    const failedEvent = await outbox.markFailed(inserted.event.id, "Temporary Telegram failure", {
      failedAt: timestamp(12),
      availableAt: timestamp(13),
    });
    expect(failedEvent).toMatchObject({ deliveryState: "failed", availableAt: timestamp(13) });

    await outbox.retry(inserted.event.id, timestamp(14));
    const thirdClaim = await outbox.claim({ now: timestamp(15), leaseDurationMs: 1_000 });
    expect(thirdClaim[0]).toMatchObject({ deliveryState: "processing", attemptCount: 3 });
    const deliveredEvent = await outbox.markDelivered(inserted.event.id, timestamp(16));
    expect(deliveredEvent).toMatchObject({ deliveryState: "delivered", deliveredAt: timestamp(16) });
    expect(await outbox.listUncertain()).toHaveLength(0);
  }, TEST_TIMEOUT_MS);

  it("automatically retries only weather claims that failed before Telegram delivery", async () => {
    const notifications = new NotificationsRepository(database.db);
    const input = {
      telegramChatId: CHAT_ID,
      weatherDay: "2026-08-04",
      transitionKey: "forecast:-100700001:2026-08-04",
      claimedAt: timestamp(1),
    } as const;
    const first = await notifications.claimWeatherForecastDay(input);
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") throw new Error("expected the initial weather claim");

    await notifications.markFailed(first.notification.id, "Provider timeout", timestamp(2));
    const retried = await notifications.claimWeatherForecastDay({
      ...input,
      claimedAt: timestamp(3),
    });
    expect(retried).toMatchObject({
      status: "claimed",
      notification: {
        id: first.notification.id,
        deliveryState: "pending",
        sentAt: null,
        uncertainAt: null,
        lastError: null,
      },
    });
    if (retried.status !== "claimed") throw new Error("expected the failed weather claim to retry");

    await notifications.markUncertain(retried.notification.id, "Telegram outcome unknown", timestamp(4));
    const duplicate = await notifications.claimWeatherForecastDay({
      ...input,
      claimedAt: timestamp(5),
    });
    expect(duplicate).toMatchObject({
      status: "duplicate",
      notification: {
        id: first.notification.id,
        deliveryState: "uncertain",
        lastError: "Telegram outcome unknown",
      },
    });
  }, TEST_TIMEOUT_MS);

  it("prevents overlapping job leases, allows expiry takeover, and rejects stale completion", async () => {
    const jobs = new JobClaimsRepository(database.db);
    const start = timestamp(1);
    const first = await jobs.tryClaim("outbox-drain", {
      claimToken: "claim-a",
      leaseDurationMs: 1_000,
      now: start,
    });
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") throw new Error("expected the initial job claim");

    const busyClaims = await Promise.all([
      jobs.tryClaim("outbox-drain", {
        claimToken: "claim-busy-1",
        leaseDurationMs: 1_000,
        now: new Date(start.getTime() + 100),
      }),
      jobs.tryClaim("outbox-drain", {
        claimToken: "claim-busy-2",
        leaseDurationMs: 1_000,
        now: new Date(start.getTime() + 100),
      }),
    ]);
    expect(busyClaims.every((claim) => claim.status === "busy")).toBe(true);
    expect(busyClaims.map((claim) => claim.claim.claimToken)).toEqual(["claim-a", "claim-a"]);

    const takeover = await jobs.tryClaim("outbox-drain", {
      claimToken: "claim-b",
      leaseDurationMs: 1_000,
      now: new Date(start.getTime() + 1_001),
    });
    expect(takeover).toMatchObject({ status: "claimed", claim: { claimToken: "claim-b" } });

    await expect(jobs.complete("outbox-drain", "claim-a", timestamp(3))).rejects.toMatchObject({
      code: "conflict",
    });
    const completed = await jobs.complete("outbox-drain", "claim-b", timestamp(4));
    expect(completed).toMatchObject({ claimToken: "claim-b", lastCompletedAt: timestamp(4) });
  }, TEST_TIMEOUT_MS);
});
