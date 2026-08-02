import type { MatchId, NotificationTransition, Vote } from "./types.js";
import { escapeHtml, truncatePlainText } from "./html.js";
import {
  formatLegacyDatePrefix,
  formatTimeInTimeZone,
  formatWeekdayCalendarDate,
  formatWeekdayDateInTimeZone,
  MINSK_TIMEZONE,
} from "./time.js";

const TELEGRAM_NOTIFICATION_MAX_LENGTH = 4096;

function formatMatchContext(matchId: MatchId, title: string | null | undefined): string {
  const normalizedTitle = title?.trim();
  return normalizedTitle === undefined || normalizedTitle === ""
    ? `#v${String(matchId)}`
    : `#v${String(matchId)} «${escapeHtml(formatLegacyDatePrefix(normalizedTitle))}»`;
}

function formatThresholdMatchContext(
  matchId: MatchId,
  title: string | null | undefined,
  scheduleDate: string | null | undefined,
  location: string | null | undefined,
): string {
  let formattedDate: string | undefined;
  try {
    formattedDate = scheduleDate === null || scheduleDate === undefined
      ? undefined
      : formatWeekdayCalendarDate(scheduleDate.trim());
  } catch {
    formattedDate = undefined;
  }
  const normalizedLocation = location?.trim();
  const details = [
    formattedDate,
    normalizedLocation === undefined || normalizedLocation === ""
      ? undefined
      : escapeHtml(normalizedLocation),
  ].filter((value): value is string => value !== undefined);
  return details.length === 0
    ? formatMatchContext(matchId, title)
    : [`#v${String(matchId)}`, ...details].join(" · ");
}

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function assertThreshold(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("threshold must be a positive safe integer");
}

export function formatThresholdNotification(
  matchId: MatchId,
  title: string | null | undefined,
  goingCount: number,
  threshold: number,
  finalDetails: {
    readonly exactTime: boolean;
    readonly location: boolean;
  } = { exactTime: false, location: false },
  scheduleDate?: string | null,
  location?: string | null,
): string {
  assertCount(goingCount, "goingCount");
  assertThreshold(threshold);
  const nextStep = finalDetails.exactTime && finalDetails.location
    ? "Нужно указать точное время и место проведения матча."
    : finalDetails.exactTime
      ? "Нужно указать точное время проведения матча."
      : finalDetails.location
        ? "Нужно указать место проведения матча."
        : "Матч готов к подтверждению.";
  return [
    "⚽ <b>Минимальный состав собран!</b>",
    `<b>${formatThresholdMatchContext(matchId, title, scheduleDate, location)}</b>`,
    `👥 Игроков: <b>${goingCount} из ${threshold}</b>`,
    "",
    nextStep,
  ].join("\n");
}

export function formatThresholdLostNotification(
  matchId: MatchId,
  title: string | null | undefined,
  goingCount: number,
  threshold: number,
  cancelledByUsername?: string | null,
  cancelledByName?: string | null,
  scheduleDate?: string | null,
  location?: string | null,
): string {
  assertCount(goingCount, "goingCount");
  assertThreshold(threshold);
  const normalizedCancelledByUsername = cancelledByUsername?.trim().replace(/^@+/u, "");
  const normalizedCancelledByName = cancelledByName?.trim();
  const cancelledBy = normalizedCancelledByUsername === undefined || normalizedCancelledByUsername === ""
    ? normalizedCancelledByName
    : `@${normalizedCancelledByUsername}`;
  return [
    "⚠️ <b>Минимальный состав снова не набран</b>",
    `<b>${formatThresholdMatchContext(matchId, title, scheduleDate, location)}</b>`,
    `👥 Игроков: <b>${goingCount} из ${threshold}</b>`,
    ...(cancelledBy === undefined || cancelledBy === ""
      ? []
      : ["", `↩️ Голос отменил: <b>${escapeHtml(cancelledBy)}</b>`]),
  ].join("\n");
}

export function formatCancellationNotification(
  matchId: MatchId,
  reason: string | null | undefined,
): string {
  const normalizedReason = reason?.trim();
  return [
    `Матч #v${String(matchId)} отменён.`,
    ...(normalizedReason === undefined || normalizedReason === ""
      ? []
      : [`Причина: ${escapeHtml(normalizedReason)}.`]),
  ].join("\n");
}

export function formatConfirmationNotification(
  input: {
    readonly scheduledAt: Date | null;
    readonly location: string | null;
    readonly fieldPriceRubles: number | null;
    readonly goingCount: number;
    readonly votes: readonly Vote[];
    readonly timezone?: string;
  },
): string {
  assertCount(input.goingCount, "goingCount");
  if (input.fieldPriceRubles !== null && (!Number.isSafeInteger(input.fieldPriceRubles) || input.fieldPriceRubles < 0)) {
    throw new Error("fieldPriceRubles must be a non-negative safe integer or null");
  }
  const timezone = input.timezone ?? MINSK_TIMEZONE;
  const schedule = input.scheduledAt === null
    ? "Дата и время уточняются"
    : `${formatWeekdayDateInTimeZone(input.scheduledAt, timezone)} · ${formatTimeInTimeZone(input.scheduledAt, timezone)}`;
  const location = input.location?.trim() || "Место уточняется";
  const fieldPrice = input.fieldPriceRubles === null ? "не указана" : `${input.fieldPriceRubles} руб.`;
  const playerWord = (() => {
    const absolute = input.goingCount % 100;
    const last = absolute % 10;
    if (absolute > 10 && absolute < 20) return "игроков";
    if (last === 1) return "игрок";
    if (last > 1 && last < 5) return "игрока";
    return "игроков";
  })();
  const baseText = [
    "⚽ <b>Состав набран — матч состоится!</b>",
    "",
    `🗓 ${escapeHtml(schedule)}`,
    `📍 ${escapeHtml(truncatePlainText(location, 512))}`,
    `💰 Стоимость поля: ${fieldPrice}`,
    `👥 Идут: ${input.goingCount} ${playerWord}`,
  ].join("\n");
  const goingVotes = input.votes.filter((vote) => vote.option === "going");
  const mentions = goingVotes.map((vote) => {
    const name = escapeHtml(truncatePlainText(vote.displayNameSnapshot.trim() || "Игрок", 200));
    return `<a href="tg://user?id=${escapeHtml(String(vote.telegramUserId))}">${name}</a>`;
  });
  if (mentions.length === 0) return baseText;

  const suffix = " — увидимся на поле!";
  const availableMentionLength = TELEGRAM_NOTIFICATION_MAX_LENGTH - baseText.length - suffix.length - 2;
  const shownMentions: string[] = [];
  let usedLength = 0;
  for (const mention of mentions) {
    const separatorLength = shownMentions.length === 0 ? 0 : 2;
    if (usedLength + separatorLength + mention.length > availableMentionLength) break;
    shownMentions.push(mention);
    usedLength += separatorLength + mention.length;
  }
  return shownMentions.length === 0
    ? baseText
    : `${baseText}\n\n${shownMentions.join(", ")}${suffix}`;
}

export interface FormattedNotificationTransition extends NotificationTransition {
  readonly text: string;
}

export function thresholdReachedNotificationTransition(input: {
  readonly matchId: MatchId;
  readonly title?: string | null;
  readonly scheduleDate?: string | null;
  readonly location?: string | null;
  readonly goingCount: number;
  readonly threshold: number;
  readonly eventKey: string;
  readonly requiresExactTime?: boolean;
  readonly requiresLocation?: boolean;
}): FormattedNotificationTransition {
  if (input.eventKey.trim() === "") throw new Error("eventKey must not be empty");
  return {
    matchId: input.matchId,
    notificationType: "threshold_reached",
    transitionKey: `threshold:reached:${input.eventKey}`,
    text: formatThresholdNotification(
      input.matchId,
      input.title,
      input.goingCount,
      input.threshold,
      {
        exactTime: input.requiresExactTime ?? false,
        location: input.requiresLocation ?? false,
      },
      input.scheduleDate,
      input.location,
    ),
  };
}

export function thresholdLostNotificationTransition(input: {
  readonly matchId: MatchId;
  readonly title?: string | null;
  readonly scheduleDate?: string | null;
  readonly location?: string | null;
  readonly goingCount: number;
  readonly threshold: number;
  readonly cancelledByUsername?: string | null;
  readonly cancelledByName?: string | null;
  readonly eventKey: string;
}): FormattedNotificationTransition {
  if (input.eventKey.trim() === "") throw new Error("eventKey must not be empty");
  return {
    matchId: input.matchId,
    notificationType: "threshold_lost",
    transitionKey: `threshold:lost:${input.eventKey}`,
    text: formatThresholdLostNotification(
      input.matchId,
      input.title,
      input.goingCount,
      input.threshold,
      input.cancelledByUsername,
      input.cancelledByName,
      input.scheduleDate,
      input.location,
    ),
  };
}

export function lifecycleNotificationTransition(input: {
  readonly matchId: MatchId;
  readonly status: "confirmed";
  readonly scheduledAt: Date | null;
  readonly location: string | null;
  readonly fieldPriceRubles: number | null;
  readonly goingCount: number;
  readonly votes: readonly Vote[];
  readonly timezone?: string;
} | {
  readonly matchId: MatchId;
  readonly status: "cancelled";
  readonly cancellationReason?: string | null;
}): FormattedNotificationTransition {
  if (input.status === "confirmed") {
    return {
      matchId: input.matchId,
      notificationType: "match_confirmed",
      transitionKey: "status:confirmed",
      text: formatConfirmationNotification(input),
    };
  }
  return {
    matchId: input.matchId,
    notificationType: "match_cancelled",
    transitionKey: "status:cancelled",
    text: formatCancellationNotification(input.matchId, input.cancellationReason),
  };
}
