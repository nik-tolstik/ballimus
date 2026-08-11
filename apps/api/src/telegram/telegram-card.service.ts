import { Inject, Injectable } from "@nestjs/common";
import { renderInformationMatchCard } from "@football/domain";
import {
  MatchMessagesRepository,
  MatchesRepository,
  VenuesRepository,
  type MatchMessage,
  type PublicationState,
} from "@football/db";

import { APP_DATABASE } from "../database/database.constants.js";
import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { EMPTY_INLINE_KEYBOARD, generalTopicSendOptions, TelegramEffects, type TelegramSendMessageInput } from "./telegram-effects.js";
import type { AppDatabase } from "@football/db";

export type TelegramCardPublicationState = PublicationState | "missing";
export type TelegramCardRefreshResult =
  | { readonly status: "refreshed"; readonly matchId: bigint; readonly messageId: bigint }
  | { readonly status: "reconciliation_required"; readonly matchId: bigint; readonly publicationState: TelegramCardPublicationState }
  | { readonly status: "skipped"; readonly matchId: bigint; readonly reason: "deleted" };
export type TelegramCardPublicationResult =
  | { readonly status: "published"; readonly reference: MatchMessage }
  | { readonly status: "reconciliation_required"; readonly reference?: MatchMessage; readonly publicationState: TelegramCardPublicationState };

/** Omits the thread parameter for Telegram's special General topic ID 1. */
export function publicCardSendOptions(generalTopicId: bigint): Pick<TelegramSendMessageInput, "messageThreadId"> {
  return generalTopicSendOptions(generalTopicId);
}

/** Renders and delivers read-only match cards without inline actions. */
@Injectable()
export class TelegramCardService {
  private readonly matches: MatchesRepository;
  private readonly matchMessages: MatchMessagesRepository;
  private readonly venues: VenuesRepository;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
  ) {
    this.matches = new MatchesRepository(db);
    this.matchMessages = new MatchMessagesRepository(db);
    this.venues = new VenuesRepository(db);
  }

  public async renderPublicCard(matchId: bigint): Promise<string> {
    const match = await this.matches.getById(matchId);
    const venue = await this.venues.getById(match.venueId);
    return renderInformationMatchCard({
      match: {
        id: match.id,
        chatId: match.telegramChatId,
        scheduledAt: match.scheduledAt,
        durationMinutes: match.durationMinutes,
        venueId: match.venueId,
        fieldPriceRubles: match.fieldPriceRubles,
        creatorTelegramUserId: match.creatorTelegramUserId,
        deletionRequestedAt: match.deletionRequestedAt,
      },
      venue: { id: venue.id, name: venue.name, mapUrl: venue.mapUrl, venueType: venue.venueType },
    }, this.config.groupTimezone);
  }

  public async refreshPublicCard(matchId: bigint): Promise<TelegramCardRefreshResult> {
    const reference = await this.matchMessages.findByMatchId(matchId);
    if (reference === undefined || reference.telegramMessageId === null) {
      return { status: "reconciliation_required", matchId, publicationState: reference?.publicationState ?? "missing" };
    }
    if (reference.publicationState === "deleted") return { status: "skipped", matchId, reason: "deleted" };
    if (reference.publicationState !== "published") {
      return { status: "reconciliation_required", matchId, publicationState: reference.publicationState };
    }
    await this.effects.editMessageText({
      chatId: reference.telegramChatId,
      messageId: reference.telegramMessageId,
      text: await this.renderPublicCard(matchId),
      replyMarkup: EMPTY_INLINE_KEYBOARD,
    });
    return { status: "refreshed", matchId, messageId: reference.telegramMessageId };
  }

  public async prepareInitialPublication(matchId: bigint): Promise<MatchMessage> {
    const existing = await this.matchMessages.findByMatchId(matchId);
    if (existing !== undefined) return existing;
    return this.matchMessages.createPending(matchId, this.config.telegramGroupChatId, this.config.telegramGeneralTopicId);
  }

  public async publishInitialCard(matchId: bigint): Promise<TelegramCardPublicationResult> {
    const reference = await this.matchMessages.findByMatchId(matchId);
    if (reference === undefined) return { status: "reconciliation_required", publicationState: "missing" };
    if (reference.publicationState !== "pending") {
      return { status: "reconciliation_required", reference, publicationState: reference.publicationState };
    }
    await this.matchMessages.markPublicationAttempt(matchId);
    try {
      const sent = await this.effects.sendMessage({
        chatId: this.config.telegramGroupChatId,
        text: await this.renderPublicCard(matchId),
        ...publicCardSendOptions(this.config.telegramGeneralTopicId),
      });
      return { status: "published", reference: await this.matchMessages.markPublished(matchId, sent.messageId) };
    } catch {
      await this.markPublicationUncertain(matchId);
      return { status: "reconciliation_required", publicationState: "uncertain" };
    }
  }

  private async markPublicationUncertain(matchId: bigint): Promise<void> {
    try {
      await this.matchMessages.markUncertain(matchId, "Initial Telegram publication requires reconciliation");
    } catch {
      // The durable outbox event remains the source of truth when this repair also fails.
    }
  }
}
