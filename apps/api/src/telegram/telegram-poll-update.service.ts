import { timingSafeEqual } from "node:crypto";

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { TelegramPollsRepository, type AppDatabase, type TelegramPoll } from "@football/db";
import { formatPollThresholdNotification } from "@football/domain";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { APP_DATABASE } from "../database/database.constants.js";
import { TelegramEffects } from "./telegram-effects.js";

export interface ParsedTelegramPollUpdate {
  readonly pollId: string;
  readonly options: readonly { readonly text: string; readonly voterCount: number }[];
  readonly isClosed: boolean;
}

export interface DirectPollThresholdNotification {
  readonly chatId: bigint;
  readonly messageThreadId: bigint;
  readonly question: string;
  readonly optionText: string;
  readonly threshold: number;
}

export interface TelegramMessageSender {
  sendMessage(input: Parameters<TelegramEffects["sendMessage"]>[0]): Promise<unknown>;
}

export function pollThresholdNotificationTarget(
  config: Pick<ApiConfig, "telegramChatTopicId">,
  poll: Pick<TelegramPoll, "telegramChatId">,
): { readonly telegramChatId: bigint; readonly telegramTopicId: bigint } {
  return {
    telegramChatId: poll.telegramChatId,
    telegramTopicId: config.telegramChatTopicId,
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parseTelegramPollUpdate(value: unknown): ParsedTelegramPollUpdate | undefined {
  const update = objectValue(value);
  const poll = objectValue(update?.["poll"]);
  if (poll === undefined) return undefined;
  const pollId = poll["id"];
  const isClosed = poll["is_closed"];
  const rawOptions = poll["options"];
  if (typeof pollId !== "string" || pollId.trim() === "" || typeof isClosed !== "boolean" || !Array.isArray(rawOptions)) {
    return undefined;
  }
  const options: { text: string; voterCount: number }[] = [];
  for (const rawOption of rawOptions) {
    const option = objectValue(rawOption);
    const text = option?.["text"];
    const voterCount = option?.["voter_count"];
    if (typeof text !== "string" || !Number.isSafeInteger(voterCount) || Number(voterCount) < 0) return undefined;
    options.push({ text, voterCount: Number(voterCount) });
  }
  return { pollId, options, isClosed };
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function sendPollThresholdNotifications(
  sender: TelegramMessageSender,
  notifications: readonly DirectPollThresholdNotification[],
): Promise<void> {
  await Promise.allSettled(notifications.map(async (notification) => sender.sendMessage({
    chatId: notification.chatId,
    messageThreadId: notification.messageThreadId,
    text: formatPollThresholdNotification(notification),
  })));
}

/** Applies authenticated Telegram poll counts and attempts each threshold notification once. */
@Injectable()
export class TelegramPollUpdateService {
  public constructor(
    @Inject(APP_DATABASE) private readonly db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
  ) {}

  public async handle(secret: string | undefined, body: unknown): Promise<{ readonly ok: true }> {
    if (!secretMatches(secret, this.config.telegramWebhookSecret)) {
      throw new UnauthorizedException({ code: "TELEGRAM_WEBHOOK_UNAUTHORIZED", message: "Telegram webhook authentication failed." });
    }
    const update = parseTelegramPollUpdate(body);
    if (update === undefined) return { ok: true };

    const notifications = await this.db.transaction(async (tx) => {
      const polls = new TelegramPollsRepository(tx);
      const current = await polls.getByTelegramPollIdForUpdate(update.pollId);
      if (current === undefined || current.archivedAt !== null) return [];
      const applied = await polls.applyTelegramUpdate(current, update.options, update.isClosed);
      const notificationTarget = pollThresholdNotificationTarget(this.config, current);
      return applied.triggers.map((trigger) => ({
        chatId: notificationTarget.telegramChatId,
        messageThreadId: notificationTarget.telegramTopicId,
        question: current.question,
        optionText: trigger.optionText,
        threshold: trigger.threshold,
      }));
    });

    await sendPollThresholdNotifications(this.effects, notifications);
    return { ok: true };
  }
}
