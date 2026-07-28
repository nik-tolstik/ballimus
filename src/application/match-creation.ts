import { DateTime } from "luxon";
import type { InlineKeyboardMarkup } from "grammy/types";

import type { Match, MatchMessage } from "../db/schema.js";
import { adminPanelContent, matchCardContent, type MatchCardContent } from "./match-card.js";
import type { MatchDraft } from "../parser/match-parser.js";

export interface MatchCreationRepositories {
  matches: {
    create(input: {
      chatId: number;
      scheduledAt: Date | null;
      location: string | null;
      fieldPriceRubles?: number | null;
      title?: string | null;
      requiredPlayers: number;
      creatorTelegramUserId: number;
      status?: "draft" | "active" | "completed" | "cancelled";
    }): Match;
    updateStatus(id: number, status: "draft" | "active" | "completed" | "cancelled"): Match | undefined;
    delete(id: number): boolean;
  };
  matchMessages: {
    upsert(input: {
      matchId: number;
      kind: "public_card" | "admin_panel";
      chatId: number;
      messageId: number;
      topicId?: number | null;
    }): MatchMessage;
  };
}

export interface MatchCardPublisher {
  sendPublicCard(request: {
    chatId: number;
    topicId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup | undefined;
  }): Promise<{ messageId: number }>;
  sendAdminPanel(request: {
    userId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup | undefined;
  }): Promise<{ messageId: number }>;
  editMessage?(request: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup | undefined;
  }): Promise<void>;
  deleteMessage?(request: { chatId: number; messageId: number }): Promise<void>;
}

export interface MatchCreationIdempotencyStore {
  get(key: string): MatchCreationResult | undefined;
  set(key: string, result: MatchCreationResult): void;
}

export class InMemoryMatchCreationIdempotencyStore implements MatchCreationIdempotencyStore {
  private readonly results = new Map<string, MatchCreationResult>();

  public get(key: string): MatchCreationResult | undefined {
    return this.results.get(key);
  }

  public set(key: string, result: MatchCreationResult): void {
    this.results.set(key, result);
  }
}

export class MatchCreationAuthorizationError extends Error {
  public constructor() {
    super("This Telegram user is not allowed to create matches");
    this.name = "MatchCreationAuthorizationError";
  }
}

export class MatchCreationError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MatchCreationError";
  }
}

export interface MatchCreationInput {
  idempotencyKey: string;
  chatId: number;
  generalTopicId: number;
  timezone: string;
  creatorTelegramUserId: number;
  draft: MatchDraft;
}

export interface MatchCreationResult {
  match: Match;
  publicMessage: MatchMessage;
  adminMessage: MatchMessage;
}

export interface MatchCreationOptions {
  repositories: MatchCreationRepositories;
  cardPublisher: MatchCardPublisher;
  idempotencyStore?: MatchCreationIdempotencyStore;
  authorizeCreator?: (telegramUserId: number, chatId: number) => boolean | Promise<boolean>;
}

function formatMatchTitle(draft: MatchDraft): string {
  const date = draft.dateLabel ?? draft.date.split("-").reverse().join(".");
  const time = draft.timeLabel ?? draft.time ?? "время уточняется";
  const priceLabel =
    draft.fieldPriceRubles === undefined || draft.fieldPriceRubles === null
      ? undefined
      : `${draft.fieldPriceRubles} рублей`;
  const details = [draft.location, priceLabel].filter(
    (value): value is string => value !== undefined && value !== null,
  );
  const suffix =
    details.length === 0
      ? ""
      : priceLabel === undefined
        ? ` — ${details[0]}`
        : ` (${details.join(", ")})`;
  return `${date} ${time}${suffix}`;
}

function scheduledAt(draft: MatchDraft, timezone: string): Date | null {
  if (draft.time === null) return null;
  const local = DateTime.fromISO(`${draft.date}T${draft.time}`, { zone: timezone });
  if (!local.isValid) {
    throw new MatchCreationError(
      "The match date/time is not valid in the configured timezone",
    );
  }
  return local.toUTC().toJSDate();
}

function activeMatch(match: Match): Match {
  return { ...match, status: "active" };
}

function initialCardContent(match: Match): MatchCardContent {
  return matchCardContent(match, [], 0);
}

function initialAdminContent(match: Match): MatchCardContent {
  return adminPanelContent(match);
}

export class MatchCreationService {
  private readonly idempotencyStore: MatchCreationIdempotencyStore;

  public constructor(private readonly options: MatchCreationOptions) {
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryMatchCreationIdempotencyStore();
  }

  public async create(input: MatchCreationInput): Promise<MatchCreationResult> {
    if (input.idempotencyKey.trim() === "") {
      throw new MatchCreationError("idempotencyKey must not be empty");
    }

    const authorized = await (this.options.authorizeCreator?.(
      input.creatorTelegramUserId,
      input.chatId,
    ) ?? true);
    if (!authorized) throw new MatchCreationAuthorizationError();

    const existing = this.idempotencyStore.get(input.idempotencyKey);
    if (existing !== undefined) return existing;

    let match: Match | undefined;
    let publicMessageId: number | undefined;
    let adminMessageId: number | undefined;

    try {
      match = this.options.repositories.matches.create({
        chatId: input.chatId,
        scheduledAt: scheduledAt(input.draft, input.timezone),
        location: input.draft.location,
        fieldPriceRubles: input.draft.fieldPriceRubles ?? null,
        title: formatMatchTitle(input.draft),
        requiredPlayers: input.draft.requiredPlayers,
        creatorTelegramUserId: input.creatorTelegramUserId,
        status: "draft",
      });

      const draftCard = initialCardContent(match);
      const publicMessage = await this.options.cardPublisher.sendPublicCard({
        chatId: input.chatId,
        topicId: input.generalTopicId,
        text: draftCard.text,
        replyMarkup: draftCard.replyMarkup,
      });
      publicMessageId = publicMessage.messageId;

      const persistedPublicMessage = this.options.repositories.matchMessages.upsert({
        matchId: match.id,
        kind: "public_card",
        chatId: input.chatId,
        messageId: publicMessage.messageId,
        topicId: input.generalTopicId,
      });

      const draftAdmin = initialAdminContent(match);
      const adminMessage = await this.options.cardPublisher.sendAdminPanel({
        userId: input.creatorTelegramUserId,
        text: draftAdmin.text,
        replyMarkup: draftAdmin.replyMarkup,
      });
      adminMessageId = adminMessage.messageId;

      const persistedAdminMessage = this.options.repositories.matchMessages.upsert({
        matchId: match.id,
        kind: "admin_panel",
        chatId: input.creatorTelegramUserId,
        messageId: adminMessage.messageId,
        topicId: null,
      });

      const activated = this.options.repositories.matches.updateStatus(match.id, "active");
      if (activated === undefined) {
        throw new MatchCreationError("The created match could not be activated");
      }

      if (this.options.cardPublisher.editMessage !== undefined) {
        const liveMatch = activeMatch(activated);
        const liveCard = matchCardContent(liveMatch, [], 0);
        await this.options.cardPublisher.editMessage({
          chatId: input.chatId,
          messageId: publicMessage.messageId,
          text: liveCard.text,
          replyMarkup: liveCard.replyMarkup,
        });
        const liveAdmin = adminPanelContent(liveMatch);
        await this.options.cardPublisher.editMessage({
          chatId: input.creatorTelegramUserId,
          messageId: adminMessage.messageId,
          text: liveAdmin.text,
          replyMarkup: liveAdmin.replyMarkup,
        });
      }

      const result = {
        match: activated,
        publicMessage: persistedPublicMessage,
        adminMessage: persistedAdminMessage,
      };
      this.idempotencyStore.set(input.idempotencyKey, result);
      return result;
    } catch (error) {
      if (this.options.cardPublisher.deleteMessage !== undefined) {
        const deletions: Promise<void>[] = [];
        if (publicMessageId !== undefined) {
          deletions.push(
            this.options.cardPublisher.deleteMessage({
              chatId: input.chatId,
              messageId: publicMessageId,
            }),
          );
        }
        if (adminMessageId !== undefined) {
          deletions.push(
            this.options.cardPublisher.deleteMessage({
              chatId: input.creatorTelegramUserId,
              messageId: adminMessageId,
            }),
          );
        }
        await Promise.allSettled(deletions);
      }
      if (match !== undefined) this.options.repositories.matches.delete(match.id);
      if (error instanceof MatchCreationError) throw error;
      throw new MatchCreationError("Match and card creation failed", { cause: error });
    }
  }
}

export function createMatchCreationService(options: MatchCreationOptions): MatchCreationService {
  return new MatchCreationService(options);
}

export { formatMatchTitle };
