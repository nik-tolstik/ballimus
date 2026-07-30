import { Inject, Injectable, Optional } from "@nestjs/common";
import type {
  AppDatabase,
  MatchMessage,
  Notification,
  OutboxEvent,
} from "@football/db";
import {
  MatchMessagesRepository,
  NotificationsRepository,
  OutboxRepository,
} from "@football/db";

import { APP_DATABASE } from "../database/database.constants.js";
import {
  TelegramCardService,
  type TelegramCardPublicationResult,
  type TelegramCardRefreshResult,
} from "../telegram/telegram-card.service.js";
import { TelegramEffects } from "../telegram/telegram-effects.js";

export const OUTBOX_RETRY_BASE_DELAY_MS = 60_000;
export const OUTBOX_RETRY_MAX_DELAY_MS = 60 * 60_000;

export interface OutboxDeliveryRepository {
  markDelivered(id: bigint, deliveredAt?: Date): Promise<OutboxEvent>;
  markFailed(
    id: bigint,
    error: string,
    options?: { readonly availableAt?: Date; readonly failedAt?: Date },
  ): Promise<OutboxEvent>;
  markUncertain(id: bigint, error: string, uncertainAt?: Date): Promise<OutboxEvent>;
}

export interface MatchMessageRepositoryPort {
  findByMatchId(matchId: bigint): Promise<MatchMessage | undefined>;
  markDeleted(matchId: bigint, deletedAt?: Date): Promise<MatchMessage | undefined>;
  markUncertain?(matchId: bigint, error: string, attemptedAt?: Date): Promise<MatchMessage>;
}

export interface NotificationRepositoryPort {
  findById(id: bigint): Promise<Notification | undefined>;
  markSent(id: bigint, sentAt?: Date, payload?: Record<string, unknown>): Promise<Notification>;
  markFailed?(id: bigint, error: string, failedAt?: Date): Promise<Notification>;
}

export type OutboxDispatchResult =
  | {
      readonly status: "delivered";
      readonly eventId: bigint;
      readonly event: OutboxEvent;
    }
  | {
      readonly status: "failed";
      readonly eventId: bigint;
      readonly event: OutboxEvent;
      readonly error: string;
      readonly availableAt: Date;
    }
  | {
      readonly status: "uncertain";
      readonly eventId: bigint;
      readonly event: OutboxEvent;
      readonly reason: string;
    };

export interface OutboxDispatchOptions {
  readonly now?: Date;
}

function requiredMatchId(event: OutboxEvent): bigint {
  if (event.matchId === null) throw new Error(`${event.eventType} event is missing matchId`);
  return event.matchId;
}

function requiredNotificationId(event: OutboxEvent): bigint {
  if (event.notificationId === null) {
    throw new Error("send_notification event is missing notificationId");
  }
  return event.notificationId;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === "" ? "Outbox delivery failed" : text;
}

function messageThreadId(topicId: bigint | null): { readonly messageThreadId?: bigint } {
  return topicId === null || topicId === 1n ? {} : { messageThreadId: topicId };
}

function textFromPayload(
  payload: Record<string, unknown>,
  fallback: Record<string, unknown> | undefined = undefined,
): string {
  const candidates = [
    payload["text"],
    payload["message"],
    payload["notificationText"],
    fallback?.["text"],
    fallback?.["message"],
    fallback?.["notificationText"],
  ];
  const text = candidates.find((candidate): candidate is string => typeof candidate === "string");
  if (text === undefined || text.trim() === "") {
    throw new Error("send_notification event has no non-empty text payload");
  }
  return text;
}

function retryAt(event: OutboxEvent, now: Date): Date {
  const exponent = Math.max(0, Math.min(event.attemptCount - 1, 10));
  const delay = Math.min(
    OUTBOX_RETRY_MAX_DELAY_MS,
    OUTBOX_RETRY_BASE_DELAY_MS * (2 ** exponent),
  );
  return new Date(now.getTime() + delay);
}

function uncertainReason(
  event: OutboxEvent,
  result: TelegramCardPublicationResult | TelegramCardRefreshResult,
): string {
  if (result.status === "reconciliation_required") {
    return `${event.eventType} requires operator reconciliation (${result.publicationState})`;
  }
  return `${event.eventType} requires operator reconciliation`;
}

/** Dispatches one leased outbox row and never retries an uncertain publication automatically. */
@Injectable()
export class OutboxDispatcher {
  private readonly delivery: OutboxDeliveryRepository;
  private readonly matchMessages: MatchMessageRepositoryPort;
  private readonly notifications: NotificationRepositoryPort;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
    @Inject(TelegramCardService) private readonly cards: TelegramCardService,
    @Optional() delivery?: OutboxDeliveryRepository,
    @Optional() matchMessages?: MatchMessageRepositoryPort,
    @Optional() notifications?: NotificationRepositoryPort,
  ) {
    this.delivery = delivery ?? new OutboxRepository(db);
    this.matchMessages = matchMessages ?? new MatchMessagesRepository(db);
    this.notifications = notifications ?? new NotificationsRepository(db);
  }

  public async dispatch(
    event: OutboxEvent,
    options: OutboxDispatchOptions = {},
  ): Promise<OutboxDispatchResult> {
    const now = options.now === undefined ? new Date() : new Date(options.now.getTime());
    try {
      return await this.dispatchEvent(event, now);
    } catch (error) {
      const message = errorText(error);
      if (event.eventType === "publish_public_card") {
        await this.markInitialPublicationUncertain(event, message, now);
        return this.markUncertain(
          event,
          `Initial public-card publication requires operator reconciliation: ${message}`,
          now,
        );
      }
      const availableAt = retryAt(event, now);
      const failed = await this.delivery.markFailed(event.id, message, {
        availableAt,
        failedAt: now,
      });
      return {
        status: "failed",
        eventId: event.id,
        event: failed,
        error: message,
        availableAt,
      };
    }
  }

  private async dispatchEvent(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    switch (event.eventType) {
      case "publish_public_card":
        return this.dispatchPublish(event, now);
      case "refresh_public_card":
        return this.dispatchRefresh(event, now);
      case "delete_public_card":
        return this.dispatchDelete(event, now);
      case "send_notification":
        return this.dispatchNotification(event, now);
      case "reconcile_public_card":
        return this.dispatchReconcile(event, now);
    }
    throw new Error(`Unsupported outbox event type: ${String(event.eventType)}`);
  }

  private async dispatchPublish(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    let result: TelegramCardPublicationResult;
    try {
      result = await this.cards.publishInitialCard(requiredMatchId(event));
    } catch (error) {
      const reason = errorText(error);
      await this.markInitialPublicationUncertain(event, reason, now);
      return this.markUncertain(
        event,
        `${event.eventType} requires operator reconciliation after an initial publication error: ${reason}`,
        now,
      );
    }
    if (result.status === "published") return this.markDelivered(event, now);
    const reason = uncertainReason(event, result);
    await this.markInitialPublicationUncertain(event, reason, now);
    return this.markUncertain(event, reason, now);
  }

  private async dispatchRefresh(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const result = await this.cards.refreshPublicCard(requiredMatchId(event));
    if (result.status === "reconciliation_required") {
      return this.markUncertain(event, uncertainReason(event, result), now);
    }
    return this.markDelivered(event, now);
  }

  private async dispatchReconcile(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const result = await this.cards.refreshPublicCard(requiredMatchId(event));
    if (result.status === "reconciliation_required") {
      return this.markUncertain(event, uncertainReason(event, result), now);
    }
    return this.markDelivered(event, now);
  }

  private async dispatchDelete(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const matchId = requiredMatchId(event);
    const reference = await this.matchMessages.findByMatchId(matchId);
    if (reference === undefined || reference.publicationState === "pending") {
      return this.markDelivered(event, now);
    }
    if (reference.publicationState === "deleted") return this.markDelivered(event, now);
    if (reference.publicationState !== "published" || reference.telegramMessageId === null) {
      return this.markUncertain(
        event,
        "Public-card deletion requires reconciliation because the stored publication is uncertain",
        now,
      );
    }

    await this.effects.deleteMessage({
      chatId: reference.telegramChatId,
      messageId: reference.telegramMessageId,
    });
    await this.matchMessages.markDeleted(matchId, now);
    return this.markDelivered(event, now);
  }

  private async dispatchNotification(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const notificationId = requiredNotificationId(event);
    const notification = await this.notifications.findById(notificationId);
    if (notification === undefined) throw new Error(`Notification ${notificationId} was not found`);
    if (notification.deliveryState === "sent") return this.markDelivered(event, now);
    if (notification.deliveryState === "uncertain") {
      return this.markUncertain(
        event,
        "Notification delivery is uncertain and requires operator reconciliation",
        now,
      );
    }

    const text = textFromPayload(event.payload, notification.payload);
    try {
      await this.effects.sendMessage({
        chatId: event.telegramChatId,
        text,
        ...messageThreadId(event.telegramTopicId),
      });
    } catch (error) {
      await this.markNotificationFailed(notification.id, errorText(error), now);
      throw error;
    }
    await this.notifications.markSent(notification.id, now, {
      ...notification.payload,
      text,
    });
    return this.markDelivered(event, now);
  }

  private async markDelivered(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const delivered = await this.delivery.markDelivered(event.id, now);
    return { status: "delivered", eventId: event.id, event: delivered };
  }

  private async markUncertain(
    event: OutboxEvent,
    reason: string,
    now: Date,
  ): Promise<OutboxDispatchResult> {
    const uncertain = await this.delivery.markUncertain(event.id, reason, now);
    return { status: "uncertain", eventId: event.id, event: uncertain, reason };
  }

  private async markInitialPublicationUncertain(
    event: OutboxEvent,
    reason: string,
    now: Date,
  ): Promise<void> {
    const matchId = event.matchId;
    const markUncertain = this.matchMessages.markUncertain;
    if (matchId === null || markUncertain === undefined) return;

    try {
      const reference = await this.matchMessages.findByMatchId(matchId);
      if (
        reference === undefined ||
        reference.publicationState === "published" ||
        reference.publicationState === "deleted" ||
        reference.publicationState === "uncertain"
      ) {
        return;
      }
      await markUncertain.call(
        this.matchMessages,
        matchId,
        `Initial Telegram publication requires reconciliation: ${reason}`,
        now,
      );
    } catch {
      // The outbox row remains uncertain even if the best-effort state repair fails.
    }
  }

  private async markNotificationFailed(
    notificationId: bigint,
    error: string,
    now: Date,
  ): Promise<void> {
    const markFailed = this.notifications.markFailed;
    if (markFailed === undefined) return;
    try {
      await markFailed.call(this.notifications, notificationId, error, now);
    } catch {
      // The outbox failure remains the retryable source of truth.
    }
  }
}
