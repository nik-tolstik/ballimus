import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppDatabase, MatchMessage, OutboxEvent } from "@football/db";
import { MatchMessagesRepository, MatchesRepository, OutboxRepository } from "@football/db";

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

export type OutboxDispatchResult =
  | { readonly status: "delivered"; readonly eventId: bigint; readonly event: OutboxEvent }
  | { readonly status: "failed"; readonly eventId: bigint; readonly event: OutboxEvent; readonly error: string; readonly availableAt: Date }
  | { readonly status: "uncertain"; readonly eventId: bigint; readonly event: OutboxEvent; readonly reason: string };

function requiredMatchId(event: OutboxEvent): bigint {
  if (event.matchId === null) throw new Error(`${event.eventType} event is missing matchId`);
  return event.matchId;
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

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
    @Inject(TelegramCardService) private readonly cards: TelegramCardService,
    @Optional() delivery?: OutboxDeliveryRepository,
    @Optional() matchMessages?: MatchMessageRepositoryPort,
    @Optional() matches?: MatchDeletionRepositoryPort,
  ) {
    this.delivery = delivery ?? new OutboxRepository(db);
    this.matchMessages = matchMessages ?? new MatchMessagesRepository(db);
    this.matches = matches ?? new MatchesRepository(db);
  }

  public async dispatch(event: OutboxEvent, options: { readonly now?: Date } = {}): Promise<OutboxDispatchResult> {
    const now = options.now === undefined ? new Date() : new Date(options.now.getTime());
    try {
      switch (event.eventType) {
        case "publish_public_card": return this.dispatchPublish(event, now);
        case "refresh_public_card":
        case "reconcile_public_card": return this.dispatchRefresh(event, now);
        case "delete_public_card": return this.dispatchDelete(event, now);
      }
    } catch (error) {
      const reason = errorText(error);
      if (event.eventType === "publish_public_card") {
        await this.markInitialPublicationUncertain(event, reason, now);
        return this.markUncertain(event, `Initial public-card publication requires reconciliation: ${reason}`, now);
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
}
