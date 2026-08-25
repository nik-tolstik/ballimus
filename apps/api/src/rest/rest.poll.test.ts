import { HttpException } from "@nestjs/common";
import { RepositoryConflictError, withTransaction } from "@football/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pollCreationInput, pollNotificationSettingsInput } from "./rest.service.js";
import { OwnerRestService } from "./rest.service.js";

vi.mock("@football/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@football/db")>();
  return { ...actual, withTransaction: vi.fn() };
});

afterEach(() => vi.mocked(withTransaction).mockReset());

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

describe("archived native poll deletion", () => {
  const createService = () => new OwnerRestService(
    {} as never,
    { telegramOwnerUserId: 100n, telegramGroupChatId: -100n } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const configureTransaction = (repositories: { readonly idempotency: object; readonly polls: object }) => {
    vi.mocked(withTransaction).mockImplementation(async (_db, operation) => operation(repositories as never));
  };

  it("does not delete a poll from another group", async () => {
    const deleteArchived = vi.fn();
    configureTransaction({
      idempotency: { beginInTransaction: vi.fn().mockResolvedValue({ status: "started", record: { id: 1n } }) },
      polls: { getByIdForUpdate: vi.fn().mockResolvedValue({ telegramChatId: -101n }), deleteArchived },
    });

    await expect(createService().deleteArchivedPoll(100n, "test-key", 1n)).rejects.toMatchObject({ status: 404 });
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
    const service = createService();

    await expect(service.deleteArchivedPoll(100n, "active-key", 1n)).rejects.toMatchObject({ status: 409 });
    await expect(service.deleteArchivedPoll(100n, "archived-key", 1n)).resolves.toEqual({ deleted: true, pollId: "1" });
    await expect(service.deleteArchivedPoll(100n, "archived-key", 1n)).resolves.toEqual({ deleted: true, pollId: "1" });
    expect(deleteArchived).toHaveBeenCalledTimes(2);
  });
});
