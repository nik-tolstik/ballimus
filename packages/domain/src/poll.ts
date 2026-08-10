import { escapeHtml } from "./html.js";

export interface PollThresholdNotificationInput {
  readonly question: string;
  readonly optionText: string;
  readonly threshold: number;
}

/** Formats the one-time chat message emitted when a decision option reaches the poll threshold. */
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
