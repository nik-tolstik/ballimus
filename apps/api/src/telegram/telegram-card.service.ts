import { Inject, Injectable } from "@nestjs/common";
import type {
  ExternalParticipant,
  Match as DomainMatch,
  MatchCardView,
  Vote as DomainVote,
} from "@football/domain";
import {
  renderMatchCard,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "@football/domain";
import {
  ExternalParticipantsRepository,
  MatchMessagesRepository,
  MatchesRepository,
  VotesRepository,
  type MatchMessage,
  type PublicationState,
} from "@football/db";
import type { InlineKeyboardMarkup } from "grammy/types";

import { APP_DATABASE } from "../database/database.constants.js";
import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import {
  canonicalGeneralTopicId,
  callbackDataForAvailability,
  callbackDataForExactTimeOption,
  callbackDataForVote,
  isConfiguredGeneralTopic,
  type TelegramCallbackSource,
} from "./callback-payload.js";
import {
  TelegramEffects,
  type TelegramSendMessageInput,
} from "./telegram-effects.js";
import type { AppDatabase, ExternalParticipant as DatabaseExternalParticipant, Match as DatabaseMatch, Vote as DatabaseVote } from "@football/db";

export type TelegramCardPublicationState = PublicationState | "missing";

export type TelegramCardRefreshResult =
  | { readonly status: "refreshed"; readonly matchId: bigint; readonly messageId: bigint }
  | {
      readonly status: "reconciliation_required";
      readonly matchId: bigint;
      readonly publicationState: TelegramCardPublicationState;
    }
  | { readonly status: "skipped"; readonly matchId: bigint; readonly reason: "deleted" };

export type TelegramCardPublicationResult =
  | { readonly status: "published"; readonly reference: MatchMessage }
  | {
      readonly status: "reconciliation_required";
      readonly reference?: MatchMessage;
      readonly publicationState: TelegramCardPublicationState;
    };

export type TelegramCardSourceValidation =
  | { readonly status: "accepted"; readonly reference: MatchMessage }
  | { readonly status: "rejected"; readonly reason: string };

function safeTelegramNumber(value: bigint, fieldName: string): number {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return Number(value);
}

/** Omits the thread parameter for Telegram's special General topic ID 1. */
export function publicCardSendOptions(generalTopicId: bigint): Pick<TelegramSendMessageInput, "messageThreadId"> {
  return generalTopicId === 1n
    ? {}
    : { messageThreadId: safeTelegramNumber(generalTopicId, "telegramGeneralTopicId") };
}

export function publicCardKeyboard(match: DatabaseMatch): InlineKeyboardMarkup {
  const matchId = match.id;
  if (match.timeMode !== "exact" && match.selectedTime === null) {
    const options = match.timeOptions;
    const availabilityRows: InlineKeyboardMarkup["inline_keyboard"] = [];
    for (let index = 0; index < options.length; index += 2) {
      availabilityRows.push(options.slice(index, index + 2).map((time) => ({
        text: match.timeMode === "availability" ? `После ${time}` : time,
        callback_data: match.timeMode === "availability"
          ? callbackDataForAvailability(matchId, time)
          : callbackDataForExactTimeOption(matchId, time),
      })));
    }
    return {
      inline_keyboard: [
        ...availabilityRows,
        [
          { text: "Под вопросом", callback_data: callbackDataForVote(matchId, "maybe") },
          { text: "Не смогу", callback_data: callbackDataForVote(matchId, "not_going") },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [[
      { text: "Участвую", callback_data: callbackDataForVote(matchId, "going") },
      { text: "Под вопросом", callback_data: callbackDataForVote(matchId, "maybe") },
      { text: "Не смогу", callback_data: callbackDataForVote(matchId, "not_going") },
    ]],
  };
}

function toDomainMatch(match: DatabaseMatch): DomainMatch {
  return {
    id: match.id,
    chatId: match.telegramChatId,
    scheduledAt: match.scheduledAt,
    scheduleDate: match.scheduleDate,
    timeMode: match.timeMode,
    timeOptions: match.timeOptions,
    selectedTime: match.selectedTime,
    location: match.location,
    venueType: match.venueType,
    fieldPriceRubles: match.fieldPriceRubles,
    title: match.title,
    requiredPlayers: match.requiredPlayers,
    status: match.status,
    cancellationReason: match.cancellationReason,
    creatorTelegramUserId: match.creatorTelegramUserId,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
}

function toDomainVote(vote: DatabaseVote): DomainVote {
  return {
    matchId: vote.matchId,
    telegramUserId: vote.telegramUserId,
    usernameSnapshot: vote.usernameSnapshot,
    displayNameSnapshot: vote.displayNameSnapshot,
    option: vote.option,
    availableAfter: vote.availableAfter,
    exactTimes: vote.exactTimes,
    updatedAt: vote.updatedAt,
  };
}

function toDomainExternalParticipant(
  participant: DatabaseExternalParticipant,
): ExternalParticipant {
  return {
    id: participant.id,
    matchId: participant.matchId,
    addedByTelegramUserId: participant.createdByTelegramUserId,
    ...(participant.sourceUpdateId === null ? {} : { sourceUpdateId: participant.sourceUpdateId }),
    sourceLabel: participant.displayName,
    displayNameSnapshot: participant.displayName,
    availableAfter: participant.availableAfter,
    quantity: participant.quantity,
    createdAt: participant.createdAt,
  };
}

function sourceTopicMatches(
  source: TelegramCallbackSource,
  reference: MatchMessage,
  config: ApiConfig,
): boolean {
  return canonicalGeneralTopicId(source.topicId, config) ===
    canonicalGeneralTopicId(reference.telegramTopicId, config);
}

export function validatePublicCardSource(
  source: TelegramCallbackSource,
  reference: MatchMessage | undefined,
  config: ApiConfig,
): TelegramCardSourceValidation {
  if (source.chatId !== config.telegramGroupChatId) {
    return { status: "rejected", reason: "callback chat is outside the configured group" };
  }
  if (!isConfiguredGeneralTopic(source.topicId, config)) {
    return { status: "rejected", reason: "callback topic is outside General" };
  }
  if (reference === undefined) {
    return { status: "rejected", reason: "public-card reference is missing" };
  }
  if (reference.publicationState !== "published" || reference.telegramMessageId === null) {
    return { status: "rejected", reason: "public-card publication is not active" };
  }
  if (reference.telegramChatId !== config.telegramGroupChatId) {
    return { status: "rejected", reason: "stored public-card chat is outside the configured group" };
  }
  if (reference.telegramMessageId !== source.messageId || !sourceTopicMatches(source, reference, config)) {
    return { status: "rejected", reason: "callback message is not the stored public card" };
  }
  return { status: "accepted", reference };
}

@Injectable()
export class TelegramCardService {
  private readonly matches: MatchesRepository;
  private readonly matchMessages: MatchMessagesRepository;
  private readonly votes: VotesRepository;
  private readonly externalParticipants: ExternalParticipantsRepository;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(API_CONFIG) private readonly apiConfig: ApiConfig,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
  ) {
    this.matches = new MatchesRepository(db);
    this.matchMessages = new MatchMessagesRepository(db);
    this.votes = new VotesRepository(db);
    this.externalParticipants = new ExternalParticipantsRepository(db);
  }

  public async validateVoteSource(
    matchId: bigint,
    source: TelegramCallbackSource,
  ): Promise<TelegramCardSourceValidation> {
    const reference = await this.matchMessages.findByMatchId(matchId);
    return validatePublicCardSource(source, reference, this.apiConfig);
  }

  public async renderPublicCard(matchId: bigint): Promise<MatchCardView> {
    const match = await this.matches.getById(matchId);
    const [votes, externalParticipants] = await Promise.all([
      this.votes.listByMatchId(matchId),
      this.externalParticipants.listByMatchId(matchId),
    ]);
    const card = renderMatchCard(
      {
        match: toDomainMatch(match),
        votes: votes.map(toDomainVote),
        externalParticipants: externalParticipants.map(toDomainExternalParticipant),
      },
      { timezone: this.apiConfig.groupTimezone, maxLength: TELEGRAM_MAX_MESSAGE_LENGTH },
    );
    if (card.text.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      throw new Error("Rendered public card exceeds Telegram's message length limit");
    }
    return card;
  }

  public async refreshPublicCard(matchId: bigint): Promise<TelegramCardRefreshResult> {
    const reference = await this.matchMessages.findByMatchId(matchId);
    if (reference === undefined || reference.telegramMessageId === null) {
      return {
        status: "reconciliation_required",
        matchId,
        publicationState: reference?.publicationState ?? "missing",
      };
    }
    if (reference.publicationState === "deleted") {
      return { status: "skipped", matchId, reason: "deleted" };
    }
    if (reference.publicationState !== "published") {
      return {
        status: "reconciliation_required",
        matchId,
        publicationState: reference.publicationState,
      };
    }

    const card = await this.renderPublicCard(matchId);
    const match = await this.matches.getById(matchId);
    await this.effects.editMessageText({
      chatId: reference.telegramChatId,
      messageId: reference.telegramMessageId,
      text: card.text,
      ...(card.isActive ? { replyMarkup: publicCardKeyboard(match) } : {}),
    });
    return { status: "refreshed", matchId, messageId: reference.telegramMessageId };
  }

  /** Creates the durable pending row required before an initial send is attempted. */
  public async prepareInitialPublication(matchId: bigint): Promise<MatchMessage> {
    const existing = await this.matchMessages.findByMatchId(matchId);
    if (existing !== undefined) return existing;
    return this.matchMessages.createPending(
      matchId,
      this.apiConfig.telegramGroupChatId,
      this.apiConfig.telegramGeneralTopicId,
    );
  }

  /** Sends only an explicitly pending publication and never creates an untracked duplicate. */
  public async publishInitialCard(matchId: bigint): Promise<TelegramCardPublicationResult> {
    const reference = await this.matchMessages.findByMatchId(matchId);
    if (reference === undefined) {
      return { status: "reconciliation_required", publicationState: "missing" };
    }
    if (reference.publicationState !== "pending") {
      return {
        status: "reconciliation_required",
        reference,
        publicationState: reference.publicationState,
      };
    }

    await this.matchMessages.markPublicationAttempt(matchId);
    try {
      const card = await this.renderPublicCard(matchId);
      const match = await this.matches.getById(matchId);
      const thread = publicCardSendOptions(this.apiConfig.telegramGeneralTopicId);
      const sent = await this.effects.sendMessage({
        chatId: this.apiConfig.telegramGroupChatId,
        text: card.text,
        ...(thread.messageThreadId === undefined ? {} : { messageThreadId: thread.messageThreadId }),
        ...(card.isActive ? { replyMarkup: publicCardKeyboard(match) } : {}),
      });
      const published = await this.matchMessages.markPublished(matchId, sent.messageId);
      return { status: "published", reference: published };
    } catch {
      await this.markPublicationUncertain(matchId);
      return {
        status: "reconciliation_required",
        publicationState: "uncertain",
      };
    }
  }

  private async markPublicationUncertain(matchId: bigint): Promise<void> {
    try {
      await this.matchMessages.markUncertain(
        matchId,
        "Initial Telegram publication requires reconciliation",
      );
    } catch {
      // The original uncertain state must be repaired by the operator if this update also fails.
    }
  }
}
