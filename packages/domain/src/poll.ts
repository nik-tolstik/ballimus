import { escapeHtml } from "./html.js";

export interface PollThresholdNotificationInput {
  readonly question: string;
  readonly optionText: string;
  readonly threshold: number;
}

export interface PollWithdrawalNotificationInput extends PollThresholdNotificationInput {
  readonly voterCount: number;
  readonly username: string | null;
  readonly displayName: string;
}

/** Formats the chat message emitted when an enabled option crosses its threshold upward. */
export function formatPollThresholdNotification(input: PollThresholdNotificationInput): string {
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 1) {
    throw new Error("Poll notification threshold must be a positive safe integer");
  }
  return [
    `🙌 <b>Набралось ${String(input.threshold)} человек</b>`,
    `Опрос: ${escapeHtml(input.question)}`,
    `Вариант: ${escapeHtml(input.optionText)}`,
  ].join("\n");
}

/** Formats a chat alert emitted when a voter takes an enabled option below its threshold. */
export function formatPollWithdrawalNotification(input: PollWithdrawalNotificationInput): string {
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 1) {
    throw new Error("Poll notification threshold must be a positive safe integer");
  }
  if (!Number.isSafeInteger(input.voterCount) || input.voterCount < 0 || input.voterCount >= input.threshold) {
    throw new Error("Poll withdrawal count must be a non-negative integer below the threshold");
  }
  const username = input.username?.trim();
  const voter = username === undefined || username === ""
    ? escapeHtml(input.displayName)
    : `@${escapeHtml(username)}`;
  return [
    "⚠️ <b>Голосов снова недостаточно</b>",
    `Опрос: ${escapeHtml(input.question)}`,
    `Вариант: ${escapeHtml(input.optionText)}`,
    `Сейчас: ${String(input.voterCount)} из ${String(input.threshold)}`,
    `Отменил голос: ${voter}`,
  ].join("\n");
}
