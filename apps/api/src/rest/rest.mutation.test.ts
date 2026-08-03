import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

const withTransactionMock = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_OWNER_USER_ID: "9876543210",
    TELEGRAM_CHAT_ID: "-100",
    TELEGRAM_GENERAL_TOPIC_ID: "1",
    TELEGRAM_CHAT_TOPIC_ID: "2",
    TELEGRAM_MINI_APP_URL: "https://mini-app.test",
    WEB_ORIGIN: "https://mini-app.test",
    LOG_LEVEL: "info",
  });
});

vi.mock("@football/db", async () => {
  const actual = await vi.importActual<typeof import("@football/db")>("@football/db");
  return { ...actual, withTransaction: withTransactionMock };
});

import {
  IdempotencyConflictError,
  type AppDatabase,
  type TransactionRepositories,
} from "@football/db";
import type { ApiConfig } from "../config/api-config.js";
import { OwnerRestService } from "./rest.service.js";

const ownerId = 9_876_543_210n;
const config: ApiConfig = {
  databaseUrl: "postgresql://test:test@localhost:5432/test",
  telegramBotToken: "123456:test-token",
  telegramWebhookSecret: "test-secret",
  telegramOwnerUserId: ownerId,
  telegramGroupChatId: -100n,
  telegramGeneralTopicId: 1n,
  telegramChatTopicId: 2n,
  telegramMiniAppUrl: "https://mini-app.test",
  webOrigin: "https://mini-app.test",
  groupTimezone: "Europe/Minsk",
  logLevel: "info",
  port: 6000,
  miniAppInitDataMaxAgeSeconds: 86_400,
};

const fakeDatabase = {} as AppDatabase;

function httpResponse(error: unknown): unknown {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe("REST mutation transaction adapter", () => {
  it("replays a stored idempotent response without invoking the business callback", async () => {
    const service = new OwnerRestService(fakeDatabase, config);
    const response = { matchId: "9000000000001", accepted: true };
    const callbackRepositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockResolvedValue({
          status: "replay",
          record: { responseStatus: 200, responseBody: response },
        }),
      },
    } as unknown as TransactionRepositories;
    withTransactionMock.mockImplementationOnce(async (_db, callback) => callback(callbackRepositories));

    await expect(service.previewMatch(ownerId, "replay-key", 1n)).resolves.toEqual(response);
  });

  it("maps a repository idempotency conflict without exposing its message", async () => {
    const service = new OwnerRestService(fakeDatabase, config);
    const repositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockRejectedValue(new IdempotencyConflictError("driver detail")),
      },
    } as unknown as TransactionRepositories;
    withTransactionMock.mockImplementationOnce(async (_db, callback) => callback(repositories));

    try {
      await service.previewMatch(ownerId, "conflict-key", 1n);
      expect.fail("Expected idempotency conflict");
    } catch (error) {
      expect(httpResponse(error)).toEqual({
        code: "IDEMPOTENCY_KEY_CONFLICT",
        message: "The idempotency key was already used for a different request.",
      });
    }
  });

  it("creates an active match and queues its initial publication in one transaction", async () => {
    const service = new OwnerRestService(fakeDatabase, config);
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    const match = {
      id: 1n,
      telegramChatId: -100n,
      scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
      scheduleDate: "2026-08-03",
      timeMode: "exact",
      timeOptions: [],
      selectedTime: null,
      location: "BOX365",
      venueType: "outdoor",
      fieldPriceRubles: null,
      title: "03.08.2026 20:00 — BOX365",
      requiredPlayers: 10,
      status: "active",
      cancellationReason: null,
      creatorTelegramUserId: ownerId,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    } as const;
    const pendingMessage = {
      matchId: 1n,
      telegramChatId: -100n,
      telegramTopicId: null,
      telegramMessageId: null,
      publicationState: "pending",
      publicationAttemptedAt: null,
      publicationUncertainAt: null,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
    } as const;
    const repositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 1n } }),
        complete: vi.fn().mockResolvedValue({}),
      },
      matches: {
        create: vi.fn().mockResolvedValue(match),
        getById: vi.fn().mockResolvedValue(match),
      },
      matchMessages: {
        createPending: vi.fn().mockResolvedValue(pendingMessage),
        findByMatchId: vi.fn().mockResolvedValue(pendingMessage),
      },
      votes: {
        listByMatchId: vi.fn().mockResolvedValue([]),
        rosterCounts: vi.fn().mockResolvedValue({
          goingVotes: 0,
          externalParticipants: 0,
          goingCount: 0,
          requiredPlayers: 10,
          thresholdReached: false,
          remainingToThreshold: 10,
        }),
      },
      externalParticipants: { listByMatchId: vi.fn().mockResolvedValue([]) },
      players: { getById: vi.fn() },
      outbox: { insertInTransaction: vi.fn().mockResolvedValue({}) },
    } as unknown as TransactionRepositories;
    withTransactionMock.mockImplementationOnce(async (_db, callback) => callback(repositories));

    const response = await service.createMatch(ownerId, "create-key", {
      date: "2026-08-03",
      time: "20:00",
      location: "BOX365",
      venueType: "outdoor",
      requiredPlayers: 10,
      fieldPriceRubles: null,
    });

    expect(repositories.matches.create).toHaveBeenCalledWith(expect.objectContaining({
      status: "active",
      title: "Понедельник, 3 августа · 20:00 — BOX365",
    }));
    expect(repositories.matchMessages.createPending).toHaveBeenCalledWith(1n, -100n, null);
    expect(repositories.outbox.insertInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "publish_public_card",
      deduplicationKey: "publish:public-card:1",
      matchId: 1n,
    }));
    expect(response).toMatchObject({
      match: { id: "1", status: "active", publicCard: { publicationState: "pending" } },
      action: { type: "publish_requested", outboxState: "pending" },
    });
  });

  it("rejects a stale If-Match before a repository update and persists the failed result", async () => {
    const service = new OwnerRestService(fakeDatabase, config);
    const match = {
      id: 1n,
      telegramChatId: -100n,
      scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
      location: "BOX365",
      venueType: "outdoor",
      fieldPriceRubles: null,
      title: "03.08.2026 20:00 — BOX365",
      requiredPlayers: 10,
      status: "active",
      cancellationReason: null,
      creatorTelegramUserId: ownerId,
      version: 3,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    } as const;
    const firstRepositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 1n } }),
      },
      matches: { getForUpdate: vi.fn().mockResolvedValue(match) },
    } as unknown as TransactionRepositories;
    const failureRepositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 2n } }),
        fail: vi.fn().mockResolvedValue({}),
      },
    } as unknown as TransactionRepositories;
    withTransactionMock
      .mockImplementationOnce(async (_db, callback) => callback(firstRepositories))
      .mockImplementationOnce(async (_db, callback) => callback(failureRepositories));

    try {
      await service.patchMatch(ownerId, "stale-key", "2", 1n, {
        location: "New venue",
      });
      expect.fail("Expected stale version conflict");
    } catch (error) {
      expect(httpResponse(error)).toMatchObject({
        code: "MATCH_VERSION_STALE",
        details: { expectedVersion: 2, actualVersion: 3 },
      });
    }
  });

  it("moves existing after-time votes to an earlier fixed time", async () => {
    const service = new OwnerRestService(fakeDatabase, config);
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    const current = {
      id: 1n,
      telegramChatId: -100n,
      scheduledAt: null,
      scheduleDate: "2026-08-03",
      timeMode: "availability",
      timeOptions: ["20:00"],
      selectedTime: null,
      location: "BOX365",
      venueType: "outdoor",
      fieldPriceRubles: null,
      title: "03.08.2026 время выбираем — BOX365",
      requiredPlayers: 10,
      status: "active",
      cancellationReason: null,
      creatorTelegramUserId: ownerId,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    } as const;
    const updated = {
      ...current,
      scheduledAt: new Date("2026-08-03T16:00:00.000Z"),
      timeMode: "exact",
      timeOptions: [],
      title: "03.08.2026 19:00 — BOX365",
      version: 2,
    } as const;
    const originalVote = {
      matchId: 1n,
      playerId: 2n,
      telegramUserId: 20_001n,
      usernameSnapshot: "available_player",
      firstNameSnapshot: "Available",
      lastNameSnapshot: "Player",
      displayNameSnapshot: "Available Player",
      option: "going",
      availableAfter: "20:00",
      exactTimes: [],
      source: "telegram_callback",
      telegramUpdateId: 10_001n,
      createdAt,
      updatedAt: createdAt,
    } as const;
    const movedVote = { ...originalVote, availableAfter: null } as const;
    const counts = {
      goingVotes: 1,
      externalParticipants: 0,
      goingCount: 1,
      requiredPlayers: 10,
      thresholdReached: false,
      remainingToThreshold: 9,
    } as const;
    const player = {
      id: 2n,
      telegramUserId: 20_001n,
      displayName: "Available Player",
      telegramUsernameSnapshot: "available_player",
      telegramFirstNameSnapshot: "Available",
      telegramLastNameSnapshot: "Player",
      telegramLanguageCode: "ru",
      lastSeenAt: createdAt,
      avatarFileUniqueId: null,
      avatarContentType: null,
      avatarDataBase64: null,
      avatarRefreshedAt: null,
      createdAt,
      updatedAt: createdAt,
    } as const;
    const listByMatchId = vi.fn()
      .mockResolvedValueOnce([originalVote])
      .mockResolvedValue([movedVote]);
    const repositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 1n } }),
        complete: vi.fn().mockResolvedValue({}),
      },
      matches: {
        getForUpdate: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue(updated),
        getById: vi.fn().mockResolvedValue(updated),
      },
      matchMessages: { findByMatchId: vi.fn().mockResolvedValue(undefined) },
      votes: {
        listByMatchId,
        clearGoingTimeSelections: vi.fn().mockResolvedValue([movedVote]),
        rosterCounts: vi.fn().mockResolvedValue(counts),
      },
      externalParticipants: { listByMatchId: vi.fn().mockResolvedValue([]), clearTimeSelections: vi.fn().mockResolvedValue([]) },
      players: { getById: vi.fn().mockResolvedValue(player) },
      outbox: { insertInTransaction: vi.fn() },
    } as unknown as TransactionRepositories;
    withTransactionMock.mockImplementationOnce(async (_db, callback) => callback(repositories));

    const response = await service.patchMatch(ownerId, "move-to-fixed-time", "1", 1n, {
      date: "2026-08-03",
      time: "19:00",
      timeMode: "exact",
      location: "BOX365",
      venueType: "outdoor",
      requiredPlayers: 10,
      fieldPriceRubles: null,
    });

    expect(repositories.matches.update).toHaveBeenCalledWith(1n, expect.objectContaining({
      scheduledAt: new Date("2026-08-03T16:00:00.000Z"),
      timeMode: "exact",
      timeOptions: [],
      expectedVersion: 1,
    }));
    expect(repositories.votes.clearGoingTimeSelections).toHaveBeenCalledWith(1n);
    expect(repositories.externalParticipants.clearTimeSelections).toHaveBeenCalledWith(1n);
    expect(response).toMatchObject({
      match: {
        timeMode: "exact",
        schedule: { date: "2026-08-03", time: "19:00" },
        roster: {
          counts: { goingCount: 1 },
          votes: [{ option: "going", availableAfter: null, exactTimes: [] }],
        },
      },
      action: { type: "match_updated" },
    });
  });

  it("sets booked details and confirms an availability match in one transaction", async () => {
    const service = new OwnerRestService(fakeDatabase, config);
    const current = {
      id: 1n,
      telegramChatId: -100n,
      scheduledAt: null,
      scheduleDate: "2026-08-03",
      timeMode: "availability",
      timeOptions: ["19:00", "20:00"],
      selectedTime: null,
      location: null,
      venueType: "outdoor",
      fieldPriceRubles: null,
      title: "03.08.2026 время выбираем",
      requiredPlayers: 10,
      status: "active",
      cancellationReason: null,
      creatorTelegramUserId: ownerId,
      version: 1,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    } as const;
    const updated = {
      ...current,
      scheduledAt: new Date("2026-08-03T17:30:00.000Z"),
      selectedTime: "20:00",
      location: "BOX365",
      fieldPriceRubles: 120,
      title: "03.08.2026 20:30 (BOX365, 120 рублей)",
      version: 2,
    } as const;
    const confirmed = { ...updated, status: "confirmed", version: 3 } as const;
    const counts = {
      goingVotes: 10,
      externalParticipants: 0,
      goingCount: 10,
      requiredPlayers: 10,
      thresholdReached: true,
      remainingToThreshold: 0,
    } as const;
    const repositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 1n } }),
        complete: vi.fn().mockResolvedValue({}),
      },
      matches: {
        getForUpdate: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue(updated),
        transitionStatus: vi.fn().mockResolvedValue(confirmed),
        getById: vi.fn().mockResolvedValue(confirmed),
      },
      matchMessages: { findByMatchId: vi.fn().mockResolvedValue(undefined) },
      votes: {
        rosterCounts: vi.fn().mockResolvedValue(counts),
        listByMatchId: vi.fn().mockResolvedValue([]),
      },
      externalParticipants: { listByMatchId: vi.fn().mockResolvedValue([]) },
      players: { getById: vi.fn() },
      notifications: { claimInTransaction: vi.fn().mockResolvedValue({ notification: { id: 5n } }) },
      outbox: { insertInTransaction: vi.fn() },
    } as unknown as TransactionRepositories;
    withTransactionMock.mockImplementationOnce(async (_db, callback) => callback(repositories));

    const response = await service.finalizeMatch(ownerId, "finalize-key", "1", 1n, {
      time: "20:30",
      location: "BOX365",
      venueType: "outdoor",
      fieldPriceRubles: 120,
    });

    expect(repositories.matches.update).toHaveBeenCalledWith(1n, expect.objectContaining({
      expectedVersion: 1,
      selectedTime: "20:00",
      location: "BOX365",
      fieldPriceRubles: 120,
    }));
    expect(repositories.matches.transitionStatus).toHaveBeenCalledWith(1n, { to: "confirmed", expectedVersion: 2 });
    expect(response).toMatchObject({
      match: {
        status: "confirmed",
        planningStage: null,
        selectedTime: "20:00",
        schedule: { time: "20:30" },
        location: "BOX365",
        fieldPriceRubles: 120,
      },
      action: { type: "match_confirmed" },
    });
  });

  it("rejects confirmation until the planning stage is ready", async () => {
    const service = new OwnerRestService(fakeDatabase, config);
    const current = {
      id: 1n,
      telegramChatId: -100n,
      scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
      scheduleDate: "2026-08-03",
      timeMode: "exact",
      timeOptions: [],
      selectedTime: null,
      location: "BOX365",
      venueType: "outdoor",
      fieldPriceRubles: 120,
      title: "03.08.2026 20:00 (BOX365, 120 рублей)",
      requiredPlayers: 10,
      status: "active",
      cancellationReason: null,
      creatorTelegramUserId: ownerId,
      version: 1,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    } as const;
    const firstRepositories = {
      idempotency: { beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 1n } }) },
      matches: { getForUpdate: vi.fn().mockResolvedValue(current) },
      votes: { rosterCounts: vi.fn().mockResolvedValue({ goingCount: 4 }) },
    } as unknown as TransactionRepositories;
    const failureRepositories = {
      idempotency: {
        beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 2n } }),
        fail: vi.fn().mockResolvedValue({}),
      },
    } as unknown as TransactionRepositories;
    withTransactionMock
      .mockImplementationOnce(async (_db, callback) => callback(firstRepositories))
      .mockImplementationOnce(async (_db, callback) => callback(failureRepositories));

    try {
      await service.confirmMatch(ownerId, "confirm-key", "1", 1n);
      expect.fail("Expected readiness conflict");
    } catch (error) {
      expect(httpResponse(error)).toEqual({
        code: "MATCH_NOT_READY_FOR_CONFIRMATION",
        message: "Select the time, reach the player threshold, and specify the venue before confirmation.",
        details: { planningStage: "recruiting_players" },
      });
    }
  });
});
