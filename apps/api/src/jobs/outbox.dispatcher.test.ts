import { describe, expect, it, vi } from "vitest";
import type { OutboxEvent } from "@football/db";

import { OutboxDispatcher } from "./outbox.dispatcher.js";

function event(): OutboxEvent {
  return {
    id: 1n, eventType: "delete_public_card", deduplicationKey: "match:1:delete", matchId: 1n,
    telegramChatId: -100n, telegramTopicId: 1n, payload: { telegramMessageId: "10" },
    deliveryState: "processing", attemptCount: 1, availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(),
    deliveredAt: null, uncertainAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

describe("OutboxDispatcher", () => {
  it("deletes a card and retains retry behavior for Telegram failures", async () => {
    const markDelivered = vi.fn().mockResolvedValue({ ...event(), deliveryState: "delivered", deliveredAt: new Date(), lockedAt: null, leaseExpiresAt: null });
    const markFailed = vi.fn();
    const markUncertain = vi.fn();
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const messages = { findByMatchId: vi.fn().mockResolvedValue({ publicationState: "published", telegramMessageId: 10n }), markDeleted: vi.fn().mockResolvedValue(undefined) };
    const matches = { deleteIfDeletionRequested: vi.fn().mockResolvedValue(true) };
    const dispatcher = new OutboxDispatcher(
      {} as never,
      { deleteMessage } as never,
      {} as never,
      { markDelivered, markFailed, markUncertain },
      messages,
      matches,
    );

    await expect(dispatcher.dispatch(event())).resolves.toMatchObject({ status: "delivered" });
    expect(deleteMessage).toHaveBeenCalledWith({ chatId: -100n, messageId: 10n });
    expect(messages.markDeleted).toHaveBeenCalledWith(1n, expect.any(Date));
    expect(matches.deleteIfDeletionRequested).toHaveBeenCalledWith(1n);
  });

  it("treats an already absent Telegram message as an idempotent deletion", async () => {
    const markDelivered = vi.fn().mockResolvedValue({ ...event(), deliveryState: "delivered", deliveredAt: new Date(), lockedAt: null, leaseExpiresAt: null });
    const dispatcher = new OutboxDispatcher(
      {} as never,
      { deleteMessage: vi.fn().mockRejectedValue({ description: "Bad Request: message to delete not found" }) } as never,
      {} as never,
      { markDelivered, markFailed: vi.fn(), markUncertain: vi.fn() },
      { findByMatchId: vi.fn().mockResolvedValue({ publicationState: "published", telegramMessageId: 10n }), markDeleted: vi.fn().mockResolvedValue(undefined) } as never,
      { deleteIfDeletionRequested: vi.fn().mockResolvedValue(true) },
    );

    await expect(dispatcher.dispatch(event())).resolves.toMatchObject({ status: "delivered" });
    expect(markDelivered).toHaveBeenCalledOnce();
  });

  it("publishes a native poll and stores its Telegram reference", async () => {
    const pollEvent = { ...event(), eventType: "publish_poll" as const, matchId: null, payload: { pollId: "7" } };
    const markDelivered = vi.fn().mockResolvedValue({ ...pollEvent, deliveryState: "delivered", deliveredAt: new Date() });
    const sendPoll = vi.fn().mockResolvedValue({
      pollId: "telegram-poll-7",
      messageId: 70n,
      options: [{ text: "Да", voterCount: 0 }, { text: "Нет", voterCount: 0 }],
    });
    const markPublished = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new OutboxDispatcher(
      {} as never,
      { sendPoll } as never,
      {} as never,
      { markDelivered, markFailed: vi.fn(), markUncertain: vi.fn() },
      {} as never,
      {} as never,
      {
        getById: vi.fn().mockResolvedValue({
          id: 7n, telegramChatId: -100n, telegramTopicId: 2n, question: "Играем?",
          options: [{ text: "Да", notificationEnabled: true }, { text: "Нет", notificationEnabled: false }], isAnonymous: false,
          allowsMultipleAnswers: false, allowsRevoting: true, publicationState: "pending", archivedAt: null,
        }),
        markPublished,
        markPublicationUncertain: vi.fn(),
        markPublicationCancelled: vi.fn(),
      } as never,
    );

    await expect(dispatcher.dispatch(pollEvent)).resolves.toMatchObject({ status: "delivered" });
    expect(sendPoll).toHaveBeenCalledWith({
      chatId: -100n,
      messageThreadId: 2n,
      question: "Играем?",
      options: ["Да", "Нет"],
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
    });
    expect(markPublished).toHaveBeenCalledWith(7n, "telegram-poll-7", 70n, expect.any(Array), expect.any(Date));
  });

  it("sends a formatted threshold notification to the poll topic", async () => {
    const notificationEvent = {
      ...event(),
      eventType: "send_poll_threshold_notification" as const,
      matchId: null,
      telegramTopicId: 2n,
      payload: { pollId: "7", question: "Играем?", optionText: "Да", threshold: 10 },
    };
    const markDelivered = vi.fn().mockResolvedValue({ ...notificationEvent, deliveryState: "delivered", deliveredAt: new Date() });
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 71n });
    const dispatcher = new OutboxDispatcher(
      {} as never,
      { sendMessage } as never,
      {} as never,
      { markDelivered, markFailed: vi.fn(), markUncertain: vi.fn() },
      {} as never,
      {} as never,
      { getById: vi.fn().mockResolvedValue({ archivedAt: null }) } as never,
    );

    await expect(dispatcher.dispatch(notificationEvent)).resolves.toMatchObject({ status: "delivered" });
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: -100n,
      messageThreadId: 2n,
      text: "🙌 <b>Набралось 10 человек</b>\nОпрос: Играем?\nВариант: Да",
    });
  });

  it("deletes an archived poll message idempotently", async () => {
    const deletePollEvent = { ...event(), eventType: "delete_poll" as const, matchId: null, payload: { pollId: "7" } };
    const markDelivered = vi.fn().mockResolvedValue({ ...deletePollEvent, deliveryState: "delivered", deliveredAt: new Date() });
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new OutboxDispatcher(
      {} as never,
      { deleteMessage } as never,
      {} as never,
      { markDelivered, markFailed: vi.fn(), markUncertain: vi.fn() },
      {} as never,
      {} as never,
      { getById: vi.fn().mockResolvedValue({ id: 7n, telegramChatId: -100n, telegramMessageId: 70n, publicationState: "published", archivedAt: new Date() }) } as never,
    );

    await expect(dispatcher.dispatch(deletePollEvent)).resolves.toMatchObject({ status: "delivered" });
    expect(deleteMessage).toHaveBeenCalledWith({ chatId: -100n, messageId: 70n });
  });

  it("cancels a pending poll publication after the poll is archived", async () => {
    const publishPollEvent = { ...event(), eventType: "publish_poll" as const, matchId: null, payload: { pollId: "7" } };
    const markDelivered = vi.fn().mockResolvedValue({ ...publishPollEvent, deliveryState: "delivered", deliveredAt: new Date() });
    const sendPoll = vi.fn();
    const markPublicationCancelled = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new OutboxDispatcher(
      {} as never,
      { sendPoll } as never,
      {} as never,
      { markDelivered, markFailed: vi.fn(), markUncertain: vi.fn() },
      {} as never,
      {} as never,
      {
        getById: vi.fn().mockResolvedValue({ id: 7n, publicationState: "pending", archivedAt: new Date() }),
        markPublicationCancelled,
        markPublicationUncertain: vi.fn(),
      } as never,
    );

    await expect(dispatcher.dispatch(publishPollEvent)).resolves.toMatchObject({ status: "delivered" });
    expect(markPublicationCancelled).toHaveBeenCalledWith(7n, expect.any(Date));
    expect(sendPoll).not.toHaveBeenCalled();
  });
});
