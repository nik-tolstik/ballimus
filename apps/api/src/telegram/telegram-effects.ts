import { Inject, Injectable } from "@nestjs/common";
import { Bot, GrammyError, type Context } from "grammy";
import type { InlineKeyboardMarkup, Update } from "grammy/types";
import type { PlayerAvatarContentType } from "@football/db";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";

export const TELEGRAM_API_TIMEOUT_MS = 5_000;
export const TELEGRAM_AVATAR_MAX_BYTES = 256 * 1024;

export interface TelegramSendMessageInput {
  readonly chatId: bigint | number | string;
  readonly text: string;
  readonly messageThreadId?: bigint | number | string;
  readonly replyMarkup?: InlineKeyboardMarkup;
}

export interface TelegramEditMessageInput {
  readonly chatId: bigint | number | string;
  readonly messageId: bigint | number | string;
  readonly text: string;
  readonly replyMarkup?: InlineKeyboardMarkup;
}

export interface TelegramDeleteMessageInput {
  readonly chatId: bigint | number | string;
  readonly messageId: bigint | number | string;
}

export interface TelegramAnswerCallbackQueryInput {
  readonly text?: string;
  readonly showAlert?: boolean;
}

export interface TelegramSentMessage {
  readonly messageId: bigint;
}

export interface TelegramProfileAvatar {
  readonly fileUniqueId: string;
  readonly contentType: PlayerAvatarContentType;
  readonly dataBase64: string;
}

export type TelegramCallbackHandler = (context: Context) => Promise<void>;

type TelegramAbortSignal = NonNullable<Parameters<Bot["api"]["sendMessage"]>[3]>;
type TelegramInitSignal = NonNullable<Parameters<Bot["init"]>[0]>;
type TelegramUpdateBot = Pick<Bot, "handleUpdate" | "init" | "isInited">;

export function telegramUpdateErrorCategory(error: unknown): string {
  if (error instanceof GrammyError) return "telegram_api";
  if (error instanceof Error && error.name === "BotError") return "telegram_update";
  return "unexpected";
}

/** Initializes grammY before manually dispatching an update in webhook mode. */
export async function handleInitializedTelegramUpdate(
  bot: TelegramUpdateBot,
  update: Update,
): Promise<void> {
  if (!bot.isInited()) {
    const signal = AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS) as unknown as TelegramInitSignal;
    await bot.init(signal);
  }
  await bot.handleUpdate(update);
}

function integerValue(value: bigint | number | string, fieldName: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${fieldName} must be a safe integer`);
    return BigInt(value);
  }
  if (!/^-?\d+$/u.test(value)) throw new TypeError(`${fieldName} must be a decimal integer`);
  return BigInt(value);
}

function chatId(value: bigint | number | string): string {
  const parsed = integerValue(value, "chatId");
  if (parsed === 0n) throw new TypeError("chatId must not be zero");
  return parsed.toString(10);
}

function positiveTelegramNumber(value: bigint | number | string, fieldName: string): number {
  const parsed = integerValue(value, fieldName);
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return Number(parsed);
}

function optionalTelegramNumber(
  value: bigint | number | string | undefined,
  fieldName: string,
): number | undefined {
  return value === undefined ? undefined : positiveTelegramNumber(value, fieldName);
}

function isMessageNotModifiedError(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.method === "editMessageText" &&
    error.error_code === 400 &&
    error.description.toLowerCase().startsWith("bad request: message is not modified")
  );
}

/** Owns grammY construction and exposes only update dispatch plus bounded API calls. */
@Injectable()
export class TelegramBotService {
  private readonly bot: Bot;
  private readonly botToken: string;

  public constructor(@Inject(API_CONFIG) apiConfig: ApiConfig) {
    this.botToken = apiConfig.telegramBotToken;
    this.bot = new Bot(apiConfig.telegramBotToken);
    this.bot.catch((error) => {
      throw new Error(`Telegram update processing failed (${telegramUpdateErrorCategory(error)})`);
    });
  }

  public registerCallbackHandler(handler: TelegramCallbackHandler): void {
    this.bot.on("callback_query", async (context) => {
      await handler(context);
    });
  }

  public async handleUpdate(update: Update): Promise<void> {
    if (update.callback_query === undefined) return;
    await handleInitializedTelegramUpdate(this.bot, update);
  }

  public async sendMessage(input: TelegramSendMessageInput): Promise<TelegramSentMessage> {
    const messageThreadId = optionalTelegramNumber(input.messageThreadId, "messageThreadId");
    const other = {
      parse_mode: "HTML" as const,
      ...(messageThreadId === undefined ? {} : { message_thread_id: messageThreadId }),
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup }),
    };
    const sent = await this.withDeadline((signal) =>
      this.bot.api.sendMessage(chatId(input.chatId), input.text, other, signal),
    );
    return { messageId: BigInt(sent.message_id) };
  }

  public async editMessageText(input: TelegramEditMessageInput): Promise<void> {
    const other = {
      parse_mode: "HTML" as const,
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup }),
    };
    try {
      await this.withDeadline((signal) =>
        this.bot.api.editMessageText(
          chatId(input.chatId),
          positiveTelegramNumber(input.messageId, "messageId"),
          input.text,
          other,
          signal,
        ),
      );
    } catch (error) {
      if (isMessageNotModifiedError(error)) return;
      throw error;
    }
  }

  public async deleteMessage(input: TelegramDeleteMessageInput): Promise<void> {
    await this.withDeadline((signal) =>
      this.bot.api.deleteMessage(
        chatId(input.chatId),
        positiveTelegramNumber(input.messageId, "messageId"),
        signal,
      ),
    );
  }

  public async answerCallbackQuery(
    callbackQueryId: string,
    input: TelegramAnswerCallbackQueryInput = {},
  ): Promise<void> {
    if (callbackQueryId.trim() === "") throw new TypeError("callbackQueryId must not be empty");
    const other = {
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.showAlert === undefined ? {} : { show_alert: input.showAlert }),
    };
    await this.withDeadline((signal) =>
      this.bot.api.answerCallbackQuery(callbackQueryId, other, signal),
    );
  }

  public async getUserProfileAvatar(
    telegramUserId: bigint | number | string,
  ): Promise<TelegramProfileAvatar | null> {
    const userId = positiveTelegramNumber(telegramUserId, "telegramUserId");
    const photos = await this.withDeadline((signal) =>
      this.bot.api.getUserProfilePhotos(userId, { offset: 0, limit: 1 }, signal),
    );
    const sizes = photos.photos[0];
    if (sizes === undefined || sizes.length === 0) return null;
    const photo = sizes.reduce((smallest, candidate) => {
      const smallestArea = smallest.width * smallest.height;
      const candidateArea = candidate.width * candidate.height;
      return candidateArea < smallestArea ? candidate : smallest;
    });
    const file = await this.withDeadline((signal) => this.bot.api.getFile(photo.file_id, signal));
    if (file.file_path === undefined) throw new Error("Telegram did not return an avatar file path");
    const fileUrl = new URL(
      `file/bot${this.botToken}/${file.file_path}`,
      "https://api.telegram.org/",
    );
    const response = await fetch(fileUrl, { signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Telegram avatar download failed with status ${response.status}`);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > TELEGRAM_AVATAR_MAX_BYTES) {
      throw new Error("Telegram avatar exceeds the cache size limit");
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > TELEGRAM_AVATAR_MAX_BYTES) {
      throw new Error("Telegram avatar is empty or exceeds the cache size limit");
    }
    const contentType = avatarContentType(response.headers.get("content-type"), file.file_path);
    return {
      fileUniqueId: photo.file_unique_id,
      contentType,
      dataBase64: Buffer.from(data).toString("base64"),
    };
  }

  private withDeadline<T>(operation: (signal: TelegramAbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS) as unknown as TelegramAbortSignal;
    return operation(signal);
  }
}

function avatarContentType(header: string | null, filePath: string): PlayerAvatarContentType {
  const normalized = header?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp") {
    return normalized;
  }
  const path = filePath.toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  throw new Error("Telegram avatar content type is not supported");
}

/** Bounded Telegram effects for post-commit outbox and reconciliation workers. */
@Injectable()
export class TelegramEffects {
  public constructor(@Inject(TelegramBotService) private readonly bot: TelegramBotService) {}

  public sendMessage(input: TelegramSendMessageInput): Promise<TelegramSentMessage> {
    return this.bot.sendMessage(input);
  }

  public editMessageText(input: TelegramEditMessageInput): Promise<void> {
    return this.bot.editMessageText(input);
  }

  public deleteMessage(input: TelegramDeleteMessageInput): Promise<void> {
    return this.bot.deleteMessage(input);
  }

  public answerCallbackQuery(
    callbackQueryId: string,
    input: TelegramAnswerCallbackQueryInput = {},
  ): Promise<void> {
    return this.bot.answerCallbackQuery(callbackQueryId, input);
  }
}
