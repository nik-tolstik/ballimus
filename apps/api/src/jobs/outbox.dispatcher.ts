import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppDatabase, MatchMessage, OutboxEvent, TelegramPoll } from "@football/db";
import { MatchMessagesRepository, MatchesRepository, OutboxRepository, TelegramPollsRepository } from "@football/db";
import { formatPollThresholdNotification } from "@football/domain";

import { APP_DATABASE } from "../database/database.constants.js";
import { TelegramCardService, type TelegramCardPublicationResult, type TelegramCardRefreshResult } from "../telegram/telegram-card.service.js";
import { TelegramEffects } from "../telegram/telegram-effects.js";

export const OUTBOX_RETRY_BASE_DELAY_MS = 60_000;
export const OUTBOX_RETRY_MAX_DELAY_MS = 60 * 60_000;

export interface OutboxDeliveryRepository {
  markDelivered(id: bigint, deliveredAt?: Date): Promise<OutboxEvent>;
  markFailed(id: bigint, error: string, options?: { readonly availableAt?: Date; readonly failedAt?: Date }): Promise<OutboxEvent>;
  markUncertain(id: bigint, error: string, uncertainAt?: Date): Promise<OutboxEvent>;
}

export interface MatchMessageRepositoryPort {
  findByMatchId(matchId: bigint): Promise<MatchMessage | undefined>;
  markDeleted(matchId: bigint, deletedAt?: Date): Promise<MatchMessage | undefined>;
  markUncertain?(matchId: bigint, error: string, attemptedAt?: Date): Promise<MatchMessage>;
}

export interface MatchDeletionRepositoryPort {
  deleteIfDeletionRequested(matchId: bigint): Promise<boolean>;
}

export interface TelegramPollRepositoryPort {
  getById(id: bigint): Promise<TelegramPoll>;
  markPublished(
    id: bigint,
    telegramPollId: string,
    telegramMessageId: bigint,
    options: readonly { readonly text: string; readonly voterCount: number }[],
    attemptedAt?: Date,
  ): Promise<TelegramPoll>;
  markPublicationUncertain(id: bigint, error: string, attemptedAt?: Date): Promise<TelegramPoll>;
  markPublicationCancelled(id: bigint, attemptedAt?: Date): Promise<TelegramPoll>;
}

export type OutboxDispatchResult =
  | { readonly status: "delivered"; readonly eventId: bigint; readonly event: OutboxEvent }
  | { readonly status: "failed"; readonly eventId: bigint; readonly event: OutboxEvent; readonly error: string; readonly availableAt: Date }
  | { readonly status: "uncertain"; readonly eventId: bigint; readonly event: OutboxEvent; readonly reason: string };

function requiredMatchId(event: OutboxEvent): bigint {
  if (event.matchId === null) throw new Error(`${event.eventType} event is missing matchId`);
  return event.matchId;
}

function requiredPollId(event: OutboxEvent): bigint {
  const value = event.payload["pollId"];
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${event.eventType} event is missing pollId`);
  }
  return BigInt(value);
}

function requiredPayloadText(event: OutboxEvent, field: string): string {
  const value = event.payload[field];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${event.eventType} event is missing ${field}`);
  return value;
}

function requiredPayloadCount(event: OutboxEvent, field: string): number {
  const value = event.payload[field];
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${event.eventType} event has invalid ${field}`);
  return Number(value);
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === "" ? "Outbox delivery failed" : text;
}

function isAlreadyDeletedTelegramMessage(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const description = (error as { readonly description?: unknown }).description;
  return typeof description === "string" && description.toLowerCase().includes("message to delete not found");
}

function retryAt(event: OutboxEvent, now: Date): Date {
  const exponent = Math.max(0, Math.min(event.attemptCount - 1, 10));
  return new Date(now.getTime() + Math.min(OUTBOX_RETRY_MAX_DELAY_MS, OUTBOX_RETRY_BASE_DELAY_MS * (2 ** exponent)));
}

function uncertainReason(event: OutboxEvent, result: TelegramCardPublicationResult | TelegramCardRefreshResult): string {
  return result.status === "reconciliation_required"
    ? `${event.eventType} requires operator reconciliation (${result.publicationState})`
    : `${event.eventType} requires operator reconciliation`;
}

function legacyMessageId(event: OutboxEvent): bigint | undefined {
  const value = event.payload["telegramMessageId"];
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}

/** Delivers durable information-card effects and retries transient Telegram failures. */
@Injectable()
export class OutboxDispatcher {
  private readonly delivery: OutboxDeliveryRepository;
  private readonly matchMessages: MatchMessageRepositoryPort;
  private readonly matches: MatchDeletionRepositoryPort;
  private readonly polls: TelegramPollRepositoryPort;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
    @Inject(TelegramCardService) private readonly cards: TelegramCardService,
    @Optional() delivery?: OutboxDeliveryRepository,
    @Optional() matchMessages?: MatchMessageRepositoryPort,
    @Optional() matches?: MatchDeletionRepositoryPort,
    @Optional() polls?: TelegramPollRepositoryPort,
  ) {
    this.delivery = delivery ?? new OutboxRepository(db);
    this.matchMessages = matchMessages ?? new MatchMessagesRepository(db);
    this.matches = matches ?? new MatchesRepository(db);
    this.polls = polls ?? new TelegramPollsRepository(db);
  }

  public async dispatch(event: OutboxEvent, options: { readonly now?: Date } = {}): Promise<OutboxDispatchResult> {
    const now = options.now === undefined ? new Date() : new Date(options.now.getTime());
    try {
      switch (event.eventType) {
        case "publish_public_card": return this.dispatchPublish(event, now);
        case "refresh_public_card": return this.dispatchRefresh(event, now);
        case "delete_public_card": return this.dispatchDelete(event, now);
        case "publish_poll": return this.dispatchPublishPoll(event, now);
        case "delete_poll": return this.dispatchDeletePoll(event, now);
        case "send_poll_threshold_notification": return this.dispatchPollThresholdNotification(event, now);
        default: throw new Error(`Unsupported outbox event type: ${event.eventType}`);
      }
    } catch (error) {
      const reason = errorText(error);
      if (event.eventType === "publish_public_card") {
        await this.markInitialPublicationUncertain(event, reason, now);
        return this.markUncertain(event, `Initial public-card publication requires reconciliation: ${reason}`, now);
      }
      if (event.eventType === "publish_poll") {
        await this.markPollPublicationUncertain(event, reason, now);
        return this.markUncertain(event, `Initial poll publication requires reconciliation: ${reason}`, now);
      }
      const availableAt = retryAt(event, now);
      const failed = await this.delivery.markFailed(event.id, reason, { availableAt, failedAt: now });
      return { status: "failed", eventId: event.id, event: failed, error: reason, availableAt };
    }
  }

  private async dispatchPublish(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const result = await this.cards.publishInitialCard(requiredMatchId(event));
    if (result.status === "published") return this.markDelivered(event, now);
    const reason = uncertainReason(event, result);
    await this.markInitialPublicationUncertain(event, reason, now);
    return this.markUncertain(event, reason, now);
  }

  private async dispatchRefresh(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const result = await this.cards.refreshPublicCard(requiredMatchId(event));
    return result.status === "reconciliation_required"
      ? this.markUncertain(event, uncertainReason(event, result), now)
      : this.markDelivered(event, now);
  }

  private async dispatchDelete(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const reference = event.matchId === null ? undefined : await this.matchMessages.findByMatchId(event.matchId);
    if (reference?.publicationState === "deleted") return this.markDelivered(event, now);
    const messageId = legacyMessageId(event) ?? reference?.telegramMessageId ?? undefined;
    if (messageId === undefined || reference?.publicationState === "pending") return this.markDelivered(event, now);
    try {
      await this.effects.deleteMessage({ chatId: event.telegramChatId, messageId });
    } catch (error) {
      if (!isAlreadyDeletedTelegramMessage(error)) throw error;
    }
    if (event.matchId !== null) await this.matchMessages.markDeleted(event.matchId, now);
    const delivered = await this.markDelivered(event, now);
    if (event.matchId !== null) await this.matches.deleteIfDeletionRequested(event.matchId);
    return delivered;
  }

  private async dispatchPublishPoll(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const pollId = requiredPollId(event);
    const poll = await this.polls.getById(pollId);
    if (poll.publicationState === "published") return this.markDelivered(event, now);
    if (poll.publicationState === "cancelled") return this.markDelivered(event, now);
    if (poll.archivedAt !== null) {
      await this.polls.markPublicationCancelled(pollId, now);
      return this.markDelivered(event, now);
    }
    if (poll.publicationState !== "pending") {
      throw new Error(`Poll ${pollId.toString(10)} cannot be published from state ${poll.publicationState}`);
    }
    const sent = await this.effects.sendPoll({
      chatId: poll.telegramChatId,
      ...(poll.telegramTopicId === null ? {} : { messageThreadId: poll.telegramTopicId }),
      question: poll.question,
      options: poll.options.map((option) => option.text),
      isAnonymous: poll.isAnonymous,
      allowsMultipleAnswers: poll.allowsMultipleAnswers,
      allowsRevoting: poll.allowsRevoting,
    });
    await this.polls.markPublished(poll.id, sent.pollId, sent.messageId, sent.options, now);
    return this.markDelivered(event, now);
  }

  private async dispatchDeletePoll(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const pollId = requiredPollId(event);
    const poll = await this.polls.getById(pollId);
    if (poll.archivedAt === null) throw new Error(`Poll ${pollId.toString(10)} is not archived`);
    if (poll.publicationState === "pending") {
      throw new Error(`Poll ${pollId.toString(10)} is still completing publication`);
    }
    if (poll.publicationState === "uncertain") {
      return this.markUncertain(event, `Archived poll ${pollId.toString(10)} requires Telegram publication reconciliation before deletion`, now);
    }
    if (poll.telegramMessageId !== null) {
      try {
        await this.effects.deleteMessage({ chatId: poll.telegramChatId, messageId: poll.telegramMessageId });
      } catch (error) {
        if (!isAlreadyDeletedTelegramMessage(error)) throw error;
      }
    }
    return this.markDelivered(event, now);
  }

  private async dispatchPollThresholdNotification(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const poll = await this.polls.getById(requiredPollId(event));
    if (poll.archivedAt !== null) return this.markDelivered(event, now);
    await this.effects.sendMessage({
      chatId: event.telegramChatId,
      ...(event.telegramTopicId === null ? {} : { messageThreadId: event.telegramTopicId }),
      text: formatPollThresholdNotification({
        question: requiredPayloadText(event, "question"),
        optionText: requiredPayloadText(event, "optionText"),
        threshold: requiredPayloadCount(event, "threshold"),
      }),
    });
    return this.markDelivered(event, now);
  }

  private async markDelivered(event: OutboxEvent, now: Date): Promise<OutboxDispatchResult> {
    const delivered = await this.delivery.markDelivered(event.id, now);
    return { status: "delivered", eventId: event.id, event: delivered };
  }

  private async markUncertain(event: OutboxEvent, reason: string, now: Date): Promise<OutboxDispatchResult> {
    const uncertain = await this.delivery.markUncertain(event.id, reason, now);
    return { status: "uncertain", eventId: event.id, event: uncertain, reason };
  }

  private async markInitialPublicationUncertain(event: OutboxEvent, reason: string, now: Date): Promise<void> {
    if (event.matchId === null || this.matchMessages.markUncertain === undefined) return;
    try {
      const reference = await this.matchMessages.findByMatchId(event.matchId);
      if (reference === undefined || reference.publicationState !== "pending") return;
      await this.matchMessages.markUncertain(event.matchId, `Initial Telegram publication requires reconciliation: ${reason}`, now);
    } catch {
      // The uncertain outbox event remains available for manual recovery.
    }
  }

  private async markPollPublicationUncertain(event: OutboxEvent, reason: string, now: Date): Promise<void> {
    try {
      await this.polls.markPublicationUncertain(requiredPollId(event), `Initial Telegram poll publication requires reconciliation: ${reason}`, now);
    } catch {
      // The uncertain outbox event remains available for manual recovery.
    }
  }
}
