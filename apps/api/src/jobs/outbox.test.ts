import type { MatchMessage, Notification, OutboxEvent } from "@football/db";
import { describe, expect, it, vi } from "vitest";

import {
  OutboxDispatcher,
  type MatchMessageRepositoryPort,
  type NotificationRepositoryPort,
  type OutboxDeliveryRepository,
} from "./outbox.dispatcher.js";
import { TelegramCardService } from "../telegram/telegram-card.service.js";
import { TelegramEffects } from "../telegram/telegram-effects.js";

const NOW = new Date("2026-07-29T00:00:00.000Z");

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 1n,
    eventType: "refresh_public_card",
    deduplicationKey: "test:event",
    matchId: 10n,
    notificationId: null,
    telegramChatId: -100n,
    telegramTopicId: 1n,
    payload: {},
    deliveryState: "processing",
    attemptCount: 1,
    availableAt: NOW,
    lockedAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    deliveredAt: null,
    uncertainAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function delivery(): OutboxDeliveryRepository {
  return {
    markDelivered: vi.fn(async (id) => event({ id, deliveryState: "delivered" })),
    markFailed: vi.fn(async (id, error) => event({ id, deliveryState: "failed", lastError: error })),
    markUncertain: vi.fn(async (id, error) => event({
      id,
      deliveryState: "uncertain",
      uncertainAt: NOW,
      lastError: error,
    })),
  };
}

function message(): MatchMessage {
  return {
    matchId: 10n,
    telegramChatId: -100n,
    telegramTopicId: 1n,
    telegramMessageId: 55n,
    publicationState: "published",
    publicationAttemptedAt: NOW,
    publicationUncertainAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function notification(): Notification {
  return {
    id: 7n,
    matchId: 10n,
    telegramChatId: -100n,
    notificationType: "match_confirmed",
    transitionKey: "confirmed:10",
    weatherDay: null,
    deliveryState: "pending",
    payload: {},
    sentAt: null,
    uncertainAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createDispatcher(
  cards: Record<string, ReturnType<typeof vi.fn>>,
  effects: Record<string, ReturnType<typeof vi.fn>>,
  deliveries = delivery(),
  messages: MatchMessageRepositoryPort = {
    findByMatchId: vi.fn().mockResolvedValue(message()),
    markDeleted: vi.fn().mockResolvedValue(undefined),
  },
  notifications: NotificationRepositoryPort = {
    findById: vi.fn().mockResolvedValue(notification()),
    markSent: vi.fn().mockResolvedValue({ ...notification(), deliveryState: "sent", sentAt: NOW }),
  },
): { dispatcher: OutboxDispatcher; deliveries: OutboxDeliveryRepository; messages: MatchMessageRepositoryPort } {
  return {
    dispatcher: new OutboxDispatcher(
      {} as never,
      effects as never,
      cards as never,
      deliveries,
      messages,
      notifications,
    ),
    deliveries,
    messages,
  };
}

describe("OutboxDispatcher", () => {
  it("declares concrete Nest injection tokens for runtime Telegram dependencies", () => {
    const dependencies = Reflect.getMetadata("self:paramtypes", OutboxDispatcher) as
      | readonly { readonly index: number; readonly param: unknown }[]
      | undefined;

    expect(dependencies).toEqual(expect.arrayContaining([
      { index: 1, param: TelegramEffects },
      { index: 2, param: TelegramCardService },
    ]));
  });

  it("dispatches a stored public-card delete before marking the event delivered", async () => {
    const deliveries = delivery();
    const messages: MatchMessageRepositoryPort = {
      findByMatchId: vi.fn().mockResolvedValue(message()),
      markDeleted: vi.fn().mockResolvedValue({ ...message(), publicationState: "deleted" }),
    };
    const effects = { deleteMessage: vi.fn().mockResolvedValue(undefined) };
    const { dispatcher } = createDispatcher({}, effects, deliveries, messages);

    const result = await dispatcher.dispatch(event({ eventType: "delete_public_card" }), { now: NOW });

    expect(result.status).toBe("delivered");
    expect(effects.deleteMessage).toHaveBeenCalledWith({ chatId: -100n, messageId: 55n });
    expect(messages.markDeleted).toHaveBeenCalledWith(10n, NOW);
    expect(deliveries.markDelivered).toHaveBeenCalledWith(1n, NOW);
  });

  it("marks a transient Telegram failure failed with a retry time", async () => {
    const deliveries = delivery();
    const effects = { editMessageText: vi.fn().mockRejectedValue(new Error("Telegram unavailable")) };
    const cards = { refreshPublicCard: vi.fn().mockRejectedValue(new Error("Telegram unavailable")) };
    const { dispatcher } = createDispatcher(cards, effects, deliveries);

    const result = await dispatcher.dispatch(event({ eventType: "refresh_public_card", attemptCount: 2 }), { now: NOW });

    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.availableAt : undefined).toEqual(
      new Date(NOW.getTime() + 120_000),
    );
    expect(deliveries.markFailed).toHaveBeenCalledWith(
      1n,
      "Telegram unavailable",
      expect.objectContaining({ availableAt: new Date(NOW.getTime() + 120_000), failedAt: NOW }),
    );
    expect(deliveries.markDelivered).not.toHaveBeenCalled();
  });

  it("marks initial publication failures uncertain instead of retrying them automatically", async () => {
    const deliveries = delivery();
    const cards = { publishInitialCard: vi.fn().mockRejectedValue(new Error("send outcome unknown")) };
    const { dispatcher } = createDispatcher(cards, {}, deliveries);

    const result = await dispatcher.dispatch(event({ eventType: "publish_public_card" }), { now: NOW });

    expect(result.status).toBe("uncertain");
    expect(deliveries.markUncertain).toHaveBeenCalledWith(
      1n,
      expect.stringContaining("reconciliation"),
      NOW,
    );
    expect(deliveries.markFailed).not.toHaveBeenCalled();
    expect(deliveries.markDelivered).not.toHaveBeenCalled();
  });

  it("sends notifications and records the notification before delivery", async () => {
    const deliveries = delivery();
    const notifications: NotificationRepositoryPort = {
      findById: vi.fn().mockResolvedValue(notification()),
      markSent: vi.fn().mockResolvedValue({ ...notification(), deliveryState: "sent", sentAt: NOW }),
    };
    const effects = { sendMessage: vi.fn().mockResolvedValue({ messageId: 99n }) };
    const { dispatcher } = createDispatcher({}, effects, deliveries, undefined, notifications);

    const result = await dispatcher.dispatch(event({
      eventType: "send_notification",
      matchId: null,
      notificationId: 7n,
      telegramTopicId: 42n,
      payload: { text: "Match confirmed" },
    }), { now: NOW });

    expect(result.status).toBe("delivered");
    expect(effects.sendMessage).toHaveBeenCalledWith({
      chatId: -100n,
      text: "Match confirmed",
      messageThreadId: 42n,
    });
    expect(notifications.markSent).toHaveBeenCalledWith(7n, NOW, {
      text: "Match confirmed",
    });
    expect(deliveries.markDelivered).toHaveBeenCalledWith(1n, NOW);
  });
});
