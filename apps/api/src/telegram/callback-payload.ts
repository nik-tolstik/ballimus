import type { CallbackQuery } from "grammy/types";

import type { ApiConfig } from "../config/api-config.js";
import { voteOptions, type VoteOption } from "@football/domain";

export const TELEGRAM_OWNER_CALLBACK_ACTIONS = [
  "edit",
  "confirm",
  "complete",
  "cancel",
  "cancel_insufficient_players",
  "cancel_bad_weather",
  "cancel_back",
] as const;

export type TelegramOwnerCallbackAction = (typeof TELEGRAM_OWNER_CALLBACK_ACTIONS)[number];

export interface TelegramVoteCallbackPayload {
  readonly kind: "vote";
  readonly matchId: bigint;
  readonly option: VoteOption;
  readonly availableAfter?: string;
}

export interface TelegramOwnerCallbackPayload {
  readonly kind: "owner";
  readonly matchId: bigint;
  readonly action: TelegramOwnerCallbackAction;
}

export type TelegramCallbackPayload =
  | TelegramVoteCallbackPayload
  | TelegramOwnerCallbackPayload;

export interface TelegramCallbackSource {
  readonly chatId: bigint;
  readonly topicId: bigint | null;
  readonly messageId: bigint;
}

function parseInteger(value: unknown, options: { readonly positive: boolean }): bigint | undefined {
  if (typeof value === "bigint") {
    if (options.positive ? value > 0n : value !== 0n) return value;
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return undefined;
    const parsed = BigInt(value);
    if (options.positive ? parsed > 0n : parsed !== 0n) return parsed;
    return undefined;
  }
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) return undefined;
  try {
    const parsed = BigInt(value);
    if (options.positive ? parsed > 0n : parsed !== 0n) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}

function isVoteOption(value: string): value is VoteOption {
  return voteOptions.includes(value as VoteOption);
}

function isOwnerCallbackAction(value: string): value is TelegramOwnerCallbackAction {
  return TELEGRAM_OWNER_CALLBACK_ACTIONS.includes(value as TelegramOwnerCallbackAction);
}

/** Parses only the callback formats emitted by this adapter. */
export function parseTelegramCallbackPayload(value: unknown): TelegramCallbackPayload | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(":");
  if (parts.length !== 3) return undefined;

  const matchId = parseInteger(parts[1], { positive: true });
  const action = parts[2];
  if (matchId === undefined || action === undefined) return undefined;

  if (parts[0] === "vote" && isVoteOption(action)) {
    return { kind: "vote", matchId, option: action };
  }
  const availabilityMatch = /^after_((?:[01]\d|2[0-3])[0-5]\d)$/u.exec(action);
  if (parts[0] === "vote" && availabilityMatch?.[1] !== undefined) {
    const compactTime = availabilityMatch[1];
    return {
      kind: "vote",
      matchId,
      option: "going",
      availableAfter: `${compactTime.slice(0, 2)}:${compactTime.slice(2)}`,
    };
  }
  if (parts[0] === "match" && isOwnerCallbackAction(action)) {
    return { kind: "owner", matchId, action };
  }
  return undefined;
}

export const parseCallbackPayload = parseTelegramCallbackPayload;

export function callbackDataForVote(matchId: bigint, option: VoteOption): string {
  return `vote:${matchId.toString(10)}:${option}`;
}

export function callbackDataForAvailability(matchId: bigint, time: string): string {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) throw new TypeError("time must use HH:mm");
  return `vote:${matchId.toString(10)}:after_${time.replace(":", "")}`;
}

function callbackIdentifier(
  value: unknown,
  positive = true,
): bigint | undefined {
  const parsed = parseInteger(value, { positive });
  if (parsed === undefined || (!positive && parsed === 0n)) return undefined;
  return parsed;
}

/** Extracts the chat/topic/message source; inline callbacks are deliberately rejected. */
export function callbackSourceFromQuery(query: CallbackQuery): TelegramCallbackSource | undefined {
  const message = query.message;
  if (message === undefined) return undefined;

  const chatId = callbackIdentifier(message.chat.id, false);
  const messageId = callbackIdentifier(message.message_id);
  if (chatId === undefined || messageId === undefined) return undefined;

  const topicId = message.message_thread_id === undefined
    ? null
    : callbackIdentifier(message.message_thread_id);
  if (message.message_thread_id !== undefined && topicId === undefined) return undefined;

  return { chatId, topicId: topicId === undefined ? null : topicId, messageId };
}

export function canonicalGeneralTopicId(
  topicId: bigint | null | undefined,
  config: Pick<ApiConfig, "telegramGeneralTopicId">,
): bigint | null {
  if (config.telegramGeneralTopicId === 1n && (topicId === null || topicId === undefined || topicId === 1n)) {
    return 1n;
  }
  return topicId === undefined ? null : topicId;
}

export function isConfiguredGeneralTopic(
  topicId: bigint | null,
  config: Pick<ApiConfig, "telegramGeneralTopicId">,
): boolean {
  return canonicalGeneralTopicId(topicId, config) ===
    canonicalGeneralTopicId(config.telegramGeneralTopicId, config);
}
