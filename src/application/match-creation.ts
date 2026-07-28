import { DateTime } from "luxon";
import type { InlineKeyboardMarkup } from "grammy/types";

import type { Match, MatchMessage, MatchStatus } from "../db/schema.js";
import {
  escapeHtml,
  formatMatchCardTitle,
  type MatchCardDisplayOptions,
} from "../domain/match-card.js";
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
      venueType?: "outdoor" | "indoor" | null;
      requiredPlayers: number;
      creatorTelegramUserId: number;
      status?: MatchStatus;
    }): Match;
    findById(id: number): Match | undefined;
    updateStatus(id: number, status: MatchStatus): Match | undefined;
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
    findByChatAndMessageId(
      chatId: number,
      messageId: number,
      kind?: "public_card" | "admin_panel",
    ): MatchMessage | undefined;
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
  get(key: string): MatchCreationCachedResult | undefined;
  set(key: string, result: MatchCreationCachedResult): void;
}

export class InMemoryMatchCreationIdempotencyStore implements MatchCreationIdempotencyStore {
  private readonly results = new Map<string, MatchCreationCachedResult>();

  public get(key: string): MatchCreationCachedResult | undefined {
    return this.results.get(key);
  }

  public set(key: string, result: MatchCreationCachedResult): void {
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

export interface MatchDraftPreviewResult {
  match: Match;
  previewMessage: MatchMessage;
}

export type MatchCreationCachedResult = MatchCreationResult | MatchDraftPreviewResult;

export const MATCH_DRAFT_ACTION_KINDS = ["publish", "edit", "cancel"] as const;
export type MatchDraftActionKind = (typeof MATCH_DRAFT_ACTION_KINDS)[number];

export interface MatchDraftAction {
  kind: MatchDraftActionKind;
  matchId: number;
}

export interface MatchDraftActionUpdate {
  telegramUserId: number;
  chatId: number;
  messageId: number;
  generalTopicId: number;
  action: MatchDraftAction;
}

export type MatchDraftActionResult =
  | {
      status: "published";
      answer: string;
      result: MatchCreationResult;
    }
  | {
      status: "discarded";
      answer: string;
      action: MatchDraftAction;
    }
  | {
      status: "ignored";
      answer: string;
    };

export interface MatchCreationOptions {
  repositories: MatchCreationRepositories;
  cardPublisher: MatchCardPublisher;
  idempotencyStore?: MatchCreationIdempotencyStore;
  authorizeCreator?: (telegramUserId: number, chatId: number) => boolean | Promise<boolean>;
  timezone?: string;
  now?: () => Date;
}

function isMatchCreationResult(result: MatchCreationCachedResult): result is MatchCreationResult {
  return "publicMessage" in result;
}

function formatMatchTitle(draft: MatchDraft): string {
  const numericDate = draft.date.split("-").reverse().join(".");
  const date = draft.dateLabel ?? numericDate;
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

export function matchDraftCallbackData(action: MatchDraftAction): string {
  return `draft:${action.matchId}:${action.kind}`;
}

export function parseMatchDraftAction(data: string): MatchDraftAction | undefined {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "draft") return undefined;

  const matchId = Number(parts[1]);
  if (!Number.isSafeInteger(matchId) || matchId < 1) return undefined;

  const kind = parts[2] as MatchDraftActionKind | undefined;
  if (kind === undefined || !MATCH_DRAFT_ACTION_KINDS.includes(kind)) return undefined;
  return { matchId, kind };
}

function venueTypeLabel(venueType: "outdoor" | "indoor" | null): string {
  return venueType === "outdoor" ? "на улице" : venueType === "indoor" ? "в здании" : "не указан";
}

export function draftPreviewContent(
  match: Match,
  displayOptions: MatchCardDisplayOptions = {},
): MatchCardContent {
  const location = match.location?.trim();
  const fieldPrice = match.fieldPriceRubles;
  return {
    text: [
      `Предпросмотр матча #v${match.id}`,
      escapeHtml(formatMatchCardTitle(match, displayOptions)),
      `Формат: ${venueTypeLabel(match.venueType)}`,
      `Нужно игроков: ${match.requiredPlayers}`,
      `Сумма: ${fieldPrice === null || fieldPrice === undefined ? "не указана" : `${fieldPrice} рублей`}`,
      `Место: ${escapeHtml(location === undefined || location === "" ? "не указано" : location)}`,
      "",
      "Проверьте данные перед публикацией.",
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: "Опубликовать",
            callback_data: matchDraftCallbackData({ kind: "publish", matchId: match.id }),
          },
          {
            text: "Исправить",
            callback_data: matchDraftCallbackData({ kind: "edit", matchId: match.id }),
          },
        ],
        [
          {
            text: "Отменить",
            callback_data: matchDraftCallbackData({ kind: "cancel", matchId: match.id }),
          },
        ],
      ],
    },
  };
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

function initialCardContent(
  match: Match,
  displayOptions: MatchCardDisplayOptions,
): MatchCardContent {
  return matchCardContent(match, [], 0, [], displayOptions);
}

function initialAdminContent(match: Match): MatchCardContent {
  return adminPanelContent(match);
}

export class MatchCreationService {
  private readonly idempotencyStore: MatchCreationIdempotencyStore;
  private readonly now: () => Date;

  public constructor(private readonly options: MatchCreationOptions) {
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryMatchCreationIdempotencyStore();
    this.now = options.now ?? (() => new Date());
  }

  private cardDisplayOptions(
    timezone = this.options.timezone ?? "Europe/Minsk",
  ): MatchCardDisplayOptions {
    return { timezone, now: this.now() };
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
    if (existing !== undefined) {
      if (isMatchCreationResult(existing)) return existing;
      throw new MatchCreationError("The idempotency key is already used by a draft preview");
    }

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
        venueType: input.draft.venueType ?? null,
        requiredPlayers: input.draft.requiredPlayers,
        creatorTelegramUserId: input.creatorTelegramUserId,
        status: "draft",
      });

      const draftCard = initialCardContent(match, this.cardDisplayOptions(input.timezone));
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
        const liveCard = matchCardContent(liveMatch, [], 0, [], this.cardDisplayOptions(input.timezone));
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

  /** Creates a private, unpublished preview that the creator can publish or discard. */
  public async createDraft(input: MatchCreationInput): Promise<MatchDraftPreviewResult> {
    if (input.idempotencyKey.trim() === "") {
      throw new MatchCreationError("idempotencyKey must not be empty");
    }

    const authorized = await (this.options.authorizeCreator?.(
      input.creatorTelegramUserId,
      input.chatId,
    ) ?? true);
    if (!authorized) throw new MatchCreationAuthorizationError();

    const existing = this.idempotencyStore.get(input.idempotencyKey);
    if (existing !== undefined) {
      if (!isMatchCreationResult(existing)) return existing;
      throw new MatchCreationError("The idempotency key is already used by a published match");
    }

    let match: Match | undefined;
    let previewMessageId: number | undefined;

    try {
      match = this.options.repositories.matches.create({
        chatId: input.chatId,
        scheduledAt: scheduledAt(input.draft, input.timezone),
        location: input.draft.location,
        fieldPriceRubles: input.draft.fieldPriceRubles ?? null,
        title: formatMatchTitle(input.draft),
        venueType: input.draft.venueType ?? null,
        requiredPlayers: input.draft.requiredPlayers,
        creatorTelegramUserId: input.creatorTelegramUserId,
        status: "draft",
      });

      const preview = draftPreviewContent(match, this.cardDisplayOptions(input.timezone));
      const sentPreview = await this.options.cardPublisher.sendAdminPanel({
        userId: input.creatorTelegramUserId,
        text: preview.text,
        replyMarkup: preview.replyMarkup,
      });
      previewMessageId = sentPreview.messageId;

      const persistedPreview = this.options.repositories.matchMessages.upsert({
        matchId: match.id,
        kind: "admin_panel",
        chatId: input.creatorTelegramUserId,
        messageId: sentPreview.messageId,
        topicId: null,
      });

      const result = { match, previewMessage: persistedPreview };
      this.idempotencyStore.set(input.idempotencyKey, result);
      return result;
    } catch (error) {
      if (previewMessageId !== undefined && this.options.cardPublisher.deleteMessage !== undefined) {
        await Promise.allSettled([
          this.options.cardPublisher.deleteMessage({
            chatId: input.creatorTelegramUserId,
            messageId: previewMessageId,
          }),
        ]);
      }
      if (match !== undefined) this.options.repositories.matches.delete(match.id);
      if (error instanceof MatchCreationError) throw error;
      throw new MatchCreationError("Match draft preview creation failed", { cause: error });
    }
  }

  /** Backward-compatible name for the private draft-preview flow. */
  public async createPreview(input: MatchCreationInput): Promise<MatchDraftPreviewResult> {
    return this.createDraft(input);
  }

  /** Processes an action from the private draft preview. */
  public async processDraftAction(update: MatchDraftActionUpdate): Promise<MatchDraftActionResult> {
    const message = this.options.repositories.matchMessages.findByChatAndMessageId(
      update.chatId,
      update.messageId,
      "admin_panel",
    );
    if (message === undefined || message.matchId !== update.action.matchId) {
      return { status: "ignored", answer: "Этот черновик больше не актуален" };
    }

    const match = this.options.repositories.matches.findById(update.action.matchId);
    if (match === undefined) return { status: "ignored", answer: "Черновик не найден" };
    if (match.creatorTelegramUserId !== update.telegramUserId || update.chatId !== update.telegramUserId) {
      return { status: "ignored", answer: "Управлять черновиком может только его создатель" };
    }
    if (!(await (this.options.authorizeCreator?.(update.telegramUserId, match.chatId) ?? true))) {
      return { status: "ignored", answer: "Недостаточно прав" };
    }
    if (match.status !== "draft") {
      return {
        status: "ignored",
        answer: match.status === "active" ? "Матч уже опубликован" : "Этот черновик больше недоступен",
      };
    }

    if (update.action.kind === "publish") {
      return this.publishDraft(match, message, update.generalTopicId);
    }
    return this.discardDraft(match, message, update.action);
  }

  /** Backward-compatible name for handling a private draft-preview button. */
  public async processPreviewAction(
    update: MatchDraftActionUpdate,
  ): Promise<MatchDraftActionResult> {
    return this.processDraftAction(update);
  }

  private async publishDraft(
    match: Match,
    previewMessage: MatchMessage,
    generalTopicId: number,
  ): Promise<MatchDraftActionResult> {
    let publicMessageId: number | undefined;
    let activated = false;

    try {
      const liveMatch = activeMatch(match);
      const liveCard = matchCardContent(liveMatch, [], 0, [], this.cardDisplayOptions());
      const sentPublicMessage = await this.options.cardPublisher.sendPublicCard({
        chatId: match.chatId,
        topicId: generalTopicId,
        text: liveCard.text,
        replyMarkup: liveCard.replyMarkup,
      });
      publicMessageId = sentPublicMessage.messageId;

      const active = this.options.repositories.matches.updateStatus(match.id, "active");
      if (active === undefined) {
        throw new MatchCreationError("The draft match could not be published");
      }
      activated = true;

      const persistedPublicMessage = this.options.repositories.matchMessages.upsert({
        matchId: active.id,
        kind: "public_card",
        chatId: active.chatId,
        messageId: sentPublicMessage.messageId,
        topicId: generalTopicId,
      });

      if (this.options.cardPublisher.editMessage !== undefined) {
        try {
          const adminContent = adminPanelContent(active);
          await this.options.cardPublisher.editMessage({
            chatId: previewMessage.chatId,
            messageId: previewMessage.messageId,
            text: adminContent.text,
            replyMarkup: adminContent.replyMarkup,
          });
        } catch (error) {
          console.error(
            `Published match preview update failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const result: MatchCreationResult = {
        match: active,
        publicMessage: persistedPublicMessage,
        adminMessage: previewMessage,
      };
      return { status: "published", answer: "Матч опубликован в General", result };
    } catch (error) {
      if (activated) this.options.repositories.matches.updateStatus(match.id, "draft");
      if (publicMessageId !== undefined && this.options.cardPublisher.deleteMessage !== undefined) {
        await Promise.allSettled([
          this.options.cardPublisher.deleteMessage({
            chatId: match.chatId,
            messageId: publicMessageId,
          }),
        ]);
      }
      if (error instanceof MatchCreationError) throw error;
      throw new MatchCreationError("Match draft publication failed", { cause: error });
    }
  }

  private async discardDraft(
    match: Match,
    previewMessage: MatchMessage,
    action: MatchDraftAction,
  ): Promise<MatchDraftActionResult> {
    const deleted = this.options.repositories.matches.delete(match.id);
    if (!deleted) return { status: "ignored", answer: "Этот черновик больше не актуален" };

    const text = action.kind === "edit"
      ? "Черновик удалён. Отправьте новый /match с исправленными данными."
      : "Черновик отменён.";
    try {
      if (this.options.cardPublisher.deleteMessage !== undefined) {
        await this.options.cardPublisher.deleteMessage({
          chatId: previewMessage.chatId,
          messageId: previewMessage.messageId,
        });
      } else if (this.options.cardPublisher.editMessage !== undefined) {
        await this.options.cardPublisher.editMessage({
          chatId: previewMessage.chatId,
          messageId: previewMessage.messageId,
          text,
          replyMarkup: { inline_keyboard: [] },
        });
      }
    } catch (error) {
      console.error(
        `Draft preview cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { status: "discarded", answer: text, action };
  }
}

export function createMatchCreationService(options: MatchCreationOptions): MatchCreationService {
  return new MatchCreationService(options);
}

export { formatMatchTitle };
