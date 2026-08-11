import { describe, expect, it, vi } from "vitest";
import { GrammyError } from "grammy";

import { TelegramPollPublicationService } from "./telegram-poll-publication.service.js";

function pendingPoll() {
  return {
    id: 7n,
    telegramChatId: -100n,
    telegramTopicId: 2n,
    question: "Играем?",
    options: [
      { text: "Да", notificationEnabled: true, voterCount: 0, notificationQueuedAt: null },
      { text: "Нет", notificationEnabled: false, voterCount: 0, notificationQueuedAt: null },
    ],
    isAnonymous: false,
    allowsMultipleAnswers: false,
    allowsRevoting: true,
    publicationState: "pending",
    archivedAt: null,
  } as const;
}

describe("TelegramPollPublicationService", () => {
  it("publishes once and stores Telegram references", async () => {
    const poll = pendingPoll();
    const published = { ...poll, publicationState: "published" as const, telegramPollId: "telegram-poll-7", telegramMessageId: 70n };
    const sender = { sendPoll: vi.fn().mockResolvedValue({ pollId: "telegram-poll-7", messageId: 70n, options: poll.options }) };
    const repository = {
      getById: vi.fn().mockResolvedValue(poll),
      markPublished: vi.fn().mockResolvedValue(published),
      markPublicationFailed: vi.fn(),
      markPublicationUncertain: vi.fn(),
      markPublicationCancelled: vi.fn(),
    };
    const service = new TelegramPollPublicationService({} as never, sender, repository as never);

    await expect(service.publishPending(7n)).resolves.toBe(published);
    expect(sender.sendPoll).toHaveBeenCalledOnce();
    expect(repository.markPublished).toHaveBeenCalledWith(7n, "telegram-poll-7", 70n, poll.options, expect.any(Date));
  });

  it("stores a definite Telegram rejection as failed", async () => {
    const poll = pendingPoll();
    const failed = { ...poll, publicationState: "failed" as const };
    const error = new GrammyError("sendPoll failed", {
      ok: false,
      error_code: 400,
      description: "Bad Request: poll options must be unique",
    }, "sendPoll", {});
    const repository = {
      getById: vi.fn().mockResolvedValue(poll),
      markPublished: vi.fn(),
      markPublicationFailed: vi.fn().mockResolvedValue(failed),
      markPublicationUncertain: vi.fn(),
      markPublicationCancelled: vi.fn(),
    };
    const service = new TelegramPollPublicationService(
      {} as never,
      { sendPoll: vi.fn().mockRejectedValue(error) },
      repository as never,
    );

    await expect(service.publishPending(7n)).resolves.toBe(failed);
    expect(repository.markPublicationFailed).toHaveBeenCalledWith(
      7n,
      "Telegram rejected the poll: Bad Request: poll options must be unique",
      expect.any(Date),
    );
    expect(repository.markPublicationUncertain).not.toHaveBeenCalled();
  });

  it("stores an unconfirmed network result as uncertain", async () => {
    const poll = pendingPoll();
    const uncertain = { ...poll, publicationState: "uncertain" as const };
    const repository = {
      getById: vi.fn().mockResolvedValue(poll),
      markPublished: vi.fn(),
      markPublicationFailed: vi.fn(),
      markPublicationUncertain: vi.fn().mockResolvedValue(uncertain),
      markPublicationCancelled: vi.fn(),
    };
    const service = new TelegramPollPublicationService(
      {} as never,
      { sendPoll: vi.fn().mockRejectedValue(new Error("request timed out")) },
      repository as never,
    );

    await expect(service.publishPending(7n)).resolves.toBe(uncertain);
    expect(repository.markPublicationUncertain).toHaveBeenCalledWith(
      7n,
      "Telegram did not confirm poll publication. Check General before republishing.",
      expect.any(Date),
    );
    expect(repository.markPublicationFailed).not.toHaveBeenCalled();
  });
});
