import { timingSafeEqual } from "node:crypto";

import { Inject, Injectable, Logger, type OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import {
  TelegramPollsRepository,
  type AppDatabase,
  type TelegramPoll,
  type TelegramPollVoterKind,
} from "@football/db";
import { formatPollThresholdNotification, formatPollWithdrawalNotification } from "@football/domain";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { APP_DATABASE } from "../database/database.constants.js";
import { TelegramEffects } from "./telegram-effects.js";

export interface ParsedTelegramPollUpdate {
  readonly pollId: string;
  readonly options: readonly { readonly text: string; readonly voterCount: number }[];
  readonly isClosed: boolean;
}

export interface ParsedTelegramPollAnswerUpdate {
  readonly telegramUpdateId: bigint;
  readonly pollId: string;
  readonly voterKind: "user" | "chat";
  readonly telegramVoterId: bigint;
  readonly username: string | null;
  readonly displayName: string;
  readonly selectedOptionIndexes: readonly number[];
}

export interface DirectPollThresholdNotification {
  readonly chatId: bigint;
  readonly messageThreadId: bigint;
  readonly question: string;
  readonly optionText: string;
  readonly threshold: number;
}

export interface DirectPollWithdrawalNotification extends DirectPollThresholdNotification {
  readonly voterCount: number;
  readonly username: string | null;
  readonly displayName: string;
}

export interface DelayedPollWithdrawalNotification extends DirectPollWithdrawalNotification {
  readonly pollId: bigint;
  readonly optionIndex: number;
  readonly voterKind: TelegramPollVoterKind;
  readonly telegramVoterId: bigint;
}

export const POLL_WITHDRAWAL_GRACE_PERIOD_MS = 10_000;

export class DelayedTaskRegistry {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  public constructor(
    private readonly delayMilliseconds: number,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    if (!Number.isSafeInteger(delayMilliseconds) || delayMilliseconds < 0) {
      throw new Error("Delayed task grace period must be a non-negative safe integer");
    }
  }

  public schedule(key: string, task: () => Promise<void>): void {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      void task().catch(this.onError);
    }, this.delayMilliseconds);
    timer.unref();
    this.pending.set(key, timer);
  }

  public cancel(key: string): void {
    const timer = this.pending.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pending.delete(key);
  }

  public close(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
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

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function parseTelegramPollAnswerUpdate(value: unknown): ParsedTelegramPollAnswerUpdate | undefined {
  const update = objectValue(value);
  const updateId = safeInteger(update?.["update_id"]);
  const answer = objectValue(update?.["poll_answer"]);
  const pollId = optionalString(answer?.["poll_id"]);
  const rawOptionIndexes = answer?.["option_ids"];
  if (updateId === undefined || updateId < 0 || pollId === undefined || !Array.isArray(rawOptionIndexes)) return undefined;
  const selectedOptionIndexes: number[] = [];
  const seen = new Set<number>();
  for (const rawIndex of rawOptionIndexes) {
    const index = safeInteger(rawIndex);
    if (index === undefined || index < 0 || seen.has(index)) return undefined;
    seen.add(index);
    selectedOptionIndexes.push(index);
  }
  selectedOptionIndexes.sort((left, right) => left - right);

  const user = objectValue(answer?.["user"]);
  if (user !== undefined) {
    const id = safeInteger(user["id"]);
    const firstName = optionalString(user["first_name"]);
    if (id === undefined || id <= 0 || firstName === undefined) return undefined;
    const lastName = optionalString(user["last_name"]);
    return {
      telegramUpdateId: BigInt(updateId),
      pollId,
      voterKind: "user",
      telegramVoterId: BigInt(id),
      username: optionalString(user["username"]) ?? null,
      displayName: lastName === undefined ? firstName : `${firstName} ${lastName}`,
      selectedOptionIndexes,
    };
  }

  const voterChat = objectValue(answer?.["voter_chat"]);
  const id = safeInteger(voterChat?.["id"]);
  if (id === undefined || id === 0) return undefined;
  const username = optionalString(voterChat?.["username"]);
  const chatPersonName = [optionalString(voterChat?.["first_name"]), optionalString(voterChat?.["last_name"])]
    .filter(Boolean)
    .join(" ");
  const displayName = optionalString(voterChat?.["title"])
    ?? (chatPersonName === "" ? undefined : chatPersonName)
    ?? username;
  if (displayName === undefined || displayName === "") return undefined;
  return {
    telegramUpdateId: BigInt(updateId),
    pollId,
    voterKind: "chat",
    telegramVoterId: BigInt(id),
    username: username ?? null,
    displayName,
    selectedOptionIndexes,
  };
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

export async function sendPollWithdrawalNotifications(
  sender: TelegramMessageSender,
  notifications: readonly DirectPollWithdrawalNotification[],
): Promise<void> {
  await Promise.allSettled(notifications.map(async (notification) => sender.sendMessage({
    chatId: notification.chatId,
    messageThreadId: notification.messageThreadId,
    text: formatPollWithdrawalNotification(notification),
  })));
}

/** Applies authenticated Telegram poll counts and emits notifications for threshold transitions. */
@Injectable()
export class TelegramPollUpdateService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollUpdateService.name);
  private readonly delayedWithdrawals = new DelayedTaskRegistry(
    POLL_WITHDRAWAL_GRACE_PERIOD_MS,
    (error) => this.logger.warn(`Delayed poll withdrawal notification failed: ${error instanceof Error ? error.message : "unknown error"}`),
  );

  public constructor(
    @Inject(APP_DATABASE) private readonly db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
  ) {}

  public onModuleDestroy(): void {
    this.delayedWithdrawals.close();
  }

  public async handle(secret: string | undefined, body: unknown): Promise<{ readonly ok: true }> {
    if (!secretMatches(secret, this.config.telegramWebhookSecret)) {
      throw new UnauthorizedException({ code: "TELEGRAM_WEBHOOK_UNAUTHORIZED", message: "Telegram webhook authentication failed." });
    }
    const pollUpdate = parseTelegramPollUpdate(body);
    if (pollUpdate !== undefined) {
      const result = await this.db.transaction(async (tx) => {
        const polls = new TelegramPollsRepository(tx);
        const current = await polls.getByTelegramPollIdForUpdate(pollUpdate.pollId);
        if (current === undefined || current.archivedAt !== null) return { notifications: [], restoredOptionIndexes: [], pollId: undefined };
        const applied = await polls.applyTelegramUpdate(current, pollUpdate.options, pollUpdate.isClosed);
        const notificationTarget = pollThresholdNotificationTarget(this.config, current);
        return {
          notifications: applied.triggers.map((trigger) => ({
            chatId: notificationTarget.telegramChatId,
            messageThreadId: notificationTarget.telegramTopicId,
            question: current.question,
            optionText: trigger.optionText,
            threshold: trigger.threshold,
          })),
          restoredOptionIndexes: current.notificationThreshold === null
            ? []
            : applied.poll.options.flatMap((option, index) => (
              option.voterCount >= current.notificationThreshold! ? [index] : []
            )),
          pollId: current.id,
        };
      });
      if (result.pollId !== undefined) {
        for (const optionIndex of result.restoredOptionIndexes) {
          this.delayedWithdrawals.cancel(this.withdrawalKey(result.pollId, optionIndex));
        }
      }
      await sendPollThresholdNotifications(this.effects, result.notifications);
      return { ok: true };
    }

    const answerUpdate = parseTelegramPollAnswerUpdate(body);
    if (answerUpdate === undefined) return { ok: true };
    const notifications = await this.db.transaction(async (tx) => {
      const polls = new TelegramPollsRepository(tx);
      const current = await polls.getByTelegramPollIdForUpdate(answerUpdate.pollId);
      if (current === undefined || current.archivedAt !== null) return [];
      const applied = await polls.applyTelegramVoterAnswer(current, {
        telegramUpdateId: answerUpdate.telegramUpdateId,
        voterKind: answerUpdate.voterKind,
        telegramVoterId: answerUpdate.telegramVoterId,
        username: answerUpdate.username,
        displayName: answerUpdate.displayName,
        selectedOptionIndexes: answerUpdate.selectedOptionIndexes,
      });
      const notificationTarget = pollThresholdNotificationTarget(this.config, current);
      return applied.triggers.map((trigger) => ({
        chatId: notificationTarget.telegramChatId,
        messageThreadId: notificationTarget.telegramTopicId,
        question: current.question,
        optionText: trigger.optionText,
        threshold: trigger.threshold,
        voterCount: trigger.voterCount,
        username: trigger.username,
        displayName: trigger.displayName,
        pollId: current.id,
        optionIndex: trigger.optionIndex,
        voterKind: trigger.voterKind,
        telegramVoterId: trigger.telegramVoterId,
      }));
    });
    this.scheduleWithdrawalNotifications(notifications);
    return { ok: true };
  }

  private withdrawalKey(pollId: bigint, optionIndex: number): string {
    return `${pollId.toString(10)}:${String(optionIndex)}`;
  }

  private scheduleWithdrawalNotifications(notifications: readonly DelayedPollWithdrawalNotification[]): void {
    for (const notification of notifications) {
      this.delayedWithdrawals.schedule(this.withdrawalKey(notification.pollId, notification.optionIndex), async () => {
        const currentNotification = await this.db.transaction(async (tx) => {
          const polls = new TelegramPollsRepository(tx);
          const poll = await polls.getById(notification.pollId);
          const answer = await polls.getVoterAnswer(
            notification.pollId,
            notification.voterKind,
            notification.telegramVoterId,
          );
          const option = poll.options[notification.optionIndex];
          if (
            poll.archivedAt !== null
            || poll.publicationState !== "published"
            || poll.notificationThreshold !== notification.threshold
            || option?.notificationEnabled !== true
            || option.voterCount >= notification.threshold
            || answer?.selectedOptionIndexes.includes(notification.optionIndex) === true
          ) {
            return undefined;
          }
          return { ...notification, voterCount: option.voterCount };
        });
        if (currentNotification !== undefined) {
          await sendPollWithdrawalNotifications(this.effects, [currentNotification]);
        }
      });
    }
  }
}
