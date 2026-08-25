import { HttpException } from "@nestjs/common";
import { RepositoryConflictError, TelegramPollsRepository, withTransaction } from "@football/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pollCreationInput, pollNotificationSettingsInput } from "./rest.service.js";
import { OwnerRestService } from "./rest.service.js";

vi.mock("@football/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@football/db")>();
  return { ...actual, TelegramPollsRepository: vi.fn(), withTransaction: vi.fn() };
});

afterEach(() => {
  vi.mocked(TelegramPollsRepository).mockReset();
  vi.mocked(withTransaction).mockReset();
});

const createPollOwnerService = () => new OwnerRestService(
  {} as never,
  { telegramOwnerUserId: 100n, telegramGroupChatId: -100n, groupTimezone: "Europe/Minsk" } as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

describe("native poll creation", () => {
  it("publishes a non-anonymous poll to General while preserving notification settings", () => {
    expect(pollCreationInput(
      { telegramGroupChatId: -100n, telegramGeneralTopicId: 1n },
      123n,
      {
        question: "Кто играет?",
        options: [
          { text: "Буду", notificationEnabled: true },
          { text: "Не буду", notificationEnabled: false },
        ],
        notificationThreshold: 10,
        allowsMultipleAnswers: false,
      },
    )).toEqual({
      telegramChatId: -100n,
      telegramTopicId: 1n,
      question: "Кто играет?",
      options: [
        { text: "Буду", notificationEnabled: true },
        { text: "Не буду", notificationEnabled: false },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: 123n,
    });
  });
});

describe("native poll notification settings", () => {
  it("maps only the ordered option notification toggles to persistence", () => {
    expect(pollNotificationSettingsInput({
      options: [
        { notificationEnabled: false },
        { notificationEnabled: true },
      ],
    })).toEqual({ notificationEnabled: [false, true] });
  });
});

describe("native poll owner boundary", () => {
  it("rejects non-owners before listing or permanently deleting polls", async () => {
    const service = new OwnerRestService(
      {} as never,
      { telegramOwnerUserId: 100n } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    for (const operation of [
      () => service.listPolls(200n, { archived: true }),
      () => service.listPollVoteHistory(200n, 1n, {}),
      () => service.deleteArchivedPoll(200n, "test-key", 1n),
    ]) {
      try {
        await operation();
        throw new Error("The owner guard should reject the request.");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(403);
      }
    }
  });
});

describe("native poll vote history", () => {
  it("returns the newest owner-visible events with a cursor", async () => {
    const getById = vi.fn().mockResolvedValue({ id: 1n, telegramChatId: -100n });
    const listVoteHistory = vi.fn().mockResolvedValue([
      {
        id: 12n,
        kind: "cancelled",
        displayName: "Иван Иванов",
        username: "player_one",
        previousSelectedOptionIndexes: [1],
        selectedOptionIndexes: [],
        occurredAt: new Date("2026-08-25T12:00:00.000Z"),
      },
      {
        id: 11n,
        kind: "changed",
        displayName: "Иван Иванов",
        username: "player_one",
        previousSelectedOptionIndexes: [0],
        selectedOptionIndexes: [1],
        occurredAt: new Date("2026-08-25T11:00:00.000Z"),
      },
      {
        id: 10n,
        kind: "voted",
        displayName: "Иван Иванов",
        username: "player_one",
        previousSelectedOptionIndexes: [],
        selectedOptionIndexes: [0],
        occurredAt: new Date("2026-08-25T10:00:00.000Z"),
      },
    ]);
    vi.mocked(TelegramPollsRepository).mockImplementation(() => ({ getById, listVoteHistory }) as never);

    await expect(createPollOwnerService().listPollVoteHistory(100n, 1n, { limit: 2 })).resolves.toEqual({
      timezone: "Europe/Minsk",
      nextCursor: "11",
      events: [
        {
          kind: "cancelled",
          displayName: "Иван Иванов",
          username: "player_one",
          previousOptionIndexes: [1],
          selectedOptionIndexes: [],
          occurredAt: "2026-08-25T12:00:00.000Z",
        },
        {
          kind: "changed",
          displayName: "Иван Иванов",
          username: "player_one",
          previousOptionIndexes: [0],
          selectedOptionIndexes: [1],
          occurredAt: "2026-08-25T11:00:00.000Z",
        },
      ],
    });
    expect(listVoteHistory).toHaveBeenCalledWith(1n, { limit: 3 });
  });

  it("hides a poll from another group", async () => {
    const getById = vi.fn().mockResolvedValue({ id: 1n, telegramChatId: -101n });
    const listVoteHistory = vi.fn();
    vi.mocked(TelegramPollsRepository).mockImplementation(() => ({ getById, listVoteHistory }) as never);

    await expect(createPollOwnerService().listPollVoteHistory(100n, 1n, {})).rejects.toMatchObject({ status: 404 });
    expect(listVoteHistory).not.toHaveBeenCalled();
  });

  it("returns history for an archived poll using the supplied cursor", async () => {
    const getById = vi.fn().mockResolvedValue({ id: 1n, telegramChatId: -100n, archivedAt: new Date("2026-08-24T12:00:00.000Z") });
    const listVoteHistory = vi.fn().mockResolvedValue([]);
    vi.mocked(TelegramPollsRepository).mockImplementation(() => ({ getById, listVoteHistory }) as never);

    await expect(createPollOwnerService().listPollVoteHistory(100n, 1n, { cursor: "24" })).resolves.toEqual({
      events: [],
      nextCursor: null,
      timezone: "Europe/Minsk",
    });
    expect(listVoteHistory).toHaveBeenCalledWith(1n, { beforeId: 24n, limit: 51 });
  });
});

describe("archived native poll deletion", () => {
  const configureTransaction = (repositories: { readonly idempotency: object; readonly polls: object }) => {
    vi.mocked(withTransaction).mockImplementation(async (_db, operation) => operation(repositories as never));
  };

  it("does not delete a poll from another group", async () => {
    const deleteArchived = vi.fn();
    configureTransaction({
      idempotency: { beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 1n } }) },
      polls: { getByIdForUpdate: vi.fn().mockResolvedValue({ telegramChatId: -101n }), deleteArchived },
    });

    await expect(createPollOwnerService().deleteArchivedPoll(100n, "test-key", 1n)).rejects.toMatchObject({ status: 404 });
    expect(deleteArchived).not.toHaveBeenCalled();
  });

  it("rejects active polls and replays a successful archived deletion", async () => {
    const deleteArchived = vi.fn()
      .mockRejectedValueOnce(new RepositoryConflictError("Only an archived poll can be permanently deleted"))
      .mockResolvedValueOnce(true);
    const beginInTransaction = vi.fn()
      .mockResolvedValueOnce({ status: "started", record: { id: 1n } })
      .mockResolvedValueOnce({ status: "started", record: { id: 2n } })
      .mockResolvedValueOnce({ status: "replay", record: { responseBody: { deleted: true, pollId: "1" }, responseStatus: 200 } });
    configureTransaction({
      idempotency: { beginInTransaction, complete: vi.fn() },
      polls: { getByIdForUpdate: vi.fn().mockResolvedValue({ telegramChatId: -100n }), deleteArchived },
    });
    const service = createPollOwnerService();

    await expect(service.deleteArchivedPoll(100n, "active-key", 1n)).rejects.toMatchObject({ status: 409 });
    await expect(service.deleteArchivedPoll(100n, "archived-key", 1n)).resolves.toEqual({ deleted: true, pollId: "1" });
    await expect(service.deleteArchivedPoll(100n, "archived-key", 1n)).resolves.toEqual({ deleted: true, pollId: "1" });
    expect(deleteArchived).toHaveBeenCalledTimes(2);
  });
});
