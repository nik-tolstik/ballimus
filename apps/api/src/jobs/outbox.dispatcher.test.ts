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
});
