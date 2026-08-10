import { Inject, Injectable } from "@nestjs/common";
import { Bot, GrammyError } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";

export const TELEGRAM_API_TIMEOUT_MS = 5_000;
export const EMPTY_INLINE_KEYBOARD: InlineKeyboardMarkup = { inline_keyboard: [] };

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

export interface TelegramSendPollInput {
  readonly chatId: bigint | number | string;
  readonly messageThreadId?: bigint | number | string;
  readonly question: string;
  readonly options: readonly string[];
  readonly isAnonymous: boolean;
  readonly allowsMultipleAnswers: boolean;
}

export interface TelegramSentMessage {
  readonly messageId: bigint;
}

export interface TelegramSentPoll {
  readonly pollId: string;
  readonly messageId: bigint;
  readonly options: readonly { readonly text: string; readonly voterCount: number }[];
}

type TelegramAbortSignal = NonNullable<Parameters<Bot["api"]["sendMessage"]>[3]>;

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

function optionalTelegramNumber(value: bigint | number | string | undefined, fieldName: string): number | undefined {
  return value === undefined ? undefined : positiveTelegramNumber(value, fieldName);
}

function isMessageNotModifiedError(error: unknown): boolean {
  return error instanceof GrammyError
    && error.method === "editMessageText"
    && error.error_code === 400
    && error.description.toLowerCase().startsWith("bad request: message is not modified");
}

/** Owns bounded outbound Telegram Bot API calls. */
@Injectable()
export class TelegramBotService {
  private readonly bot: Bot;

  public constructor(@Inject(API_CONFIG) apiConfig: ApiConfig) {
    this.bot = new Bot(apiConfig.telegramBotToken);
  }

  public async sendMessage(input: TelegramSendMessageInput): Promise<TelegramSentMessage> {
    const messageThreadId = optionalTelegramNumber(input.messageThreadId, "messageThreadId");
    const sent = await this.withDeadline((signal) => this.bot.api.sendMessage(chatId(input.chatId), input.text, {
      parse_mode: "HTML",
      ...(messageThreadId === undefined ? {} : { message_thread_id: messageThreadId }),
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup }),
    }, signal));
    return { messageId: BigInt(sent.message_id) };
  }

  public async editMessageText(input: TelegramEditMessageInput): Promise<void> {
    try {
      await this.withDeadline((signal) => this.bot.api.editMessageText(
        chatId(input.chatId),
        positiveTelegramNumber(input.messageId, "messageId"),
        input.text,
        { parse_mode: "HTML", ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup }) },
        signal,
      ));
    } catch (error) {
      if (isMessageNotModifiedError(error)) return;
      throw error;
    }
  }

  public async deleteMessage(input: TelegramDeleteMessageInput): Promise<void> {
    await this.withDeadline((signal) => this.bot.api.deleteMessage(
      chatId(input.chatId),
      positiveTelegramNumber(input.messageId, "messageId"),
      signal,
    ));
  }

  public async sendPoll(input: TelegramSendPollInput): Promise<TelegramSentPoll> {
    const messageThreadId = optionalTelegramNumber(input.messageThreadId, "messageThreadId");
    const sent = await this.withDeadline((signal) => this.bot.api.sendPoll(
      chatId(input.chatId),
      input.question,
      input.options.map((text) => ({ text })),
      {
        is_anonymous: input.isAnonymous,
        type: "regular",
        allows_multiple_answers: input.allowsMultipleAnswers,
        ...(messageThreadId === undefined ? {} : { message_thread_id: messageThreadId }),
      },
      signal,
    ));
    return {
      pollId: sent.poll.id,
      messageId: BigInt(sent.message_id),
      options: sent.poll.options.map((option) => ({ text: option.text, voterCount: option.voter_count })),
    };
  }

  private withDeadline<T>(operation: (signal: TelegramAbortSignal) => Promise<T>): Promise<T> {
    return operation(AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS) as unknown as TelegramAbortSignal);
  }
}

/** Bounded Telegram effects for the durable public-card outbox. */
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

  public sendPoll(input: TelegramSendPollInput): Promise<TelegramSentPoll> {
    return this.bot.sendPoll(input);
  }
}
