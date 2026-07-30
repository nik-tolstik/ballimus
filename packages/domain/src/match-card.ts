import { groupExternalParticipants, totalExternalParticipantQuantity } from "./external-participants.js";
import { escapeHtml, escapedTextWithinLimit, truncatePlainText } from "./html.js";
import type { ExternalParticipant, Match, Vote, VoteOption } from "./types.js";
import { calendarDateInTimeZone, formatDateInTimeZone, formatTimeInTimeZone, MINSK_TIMEZONE } from "./time.js";
import { cumulativeAvailabilityCount, isVoteEligibleForMatch, matchTimeMode } from "./availability.js";
import { deriveMatchPlanningStage, matchPlanningStageLabel } from "./planning-stage.js";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const DEFAULT_MATCH_CARD_TIMEZONE = MINSK_TIMEZONE;

export interface MatchCardData {
  readonly match: Match;
  readonly votes: readonly Vote[];
  /** When omitted, the external quantity ledger is summed from externalParticipants. */
  readonly externalCount?: number;
  readonly externalParticipants?: readonly ExternalParticipant[];
}

export interface MatchCardDisplayOptions {
  readonly timezone?: string;
  readonly now?: Date;
  readonly maxLength?: number;
}

export interface MatchCardView {
  readonly text: string;
  readonly isActive: boolean;
}

function fieldPriceLabel(match: Match): string {
  const price = match.fieldPriceRubles;
  return price === null ? "не указана" : `${price} рублей`;
}

function playerRangeLabel(requiredPlayers: number): string {
  return `${requiredPlayers}-${requiredPlayers + 2} человек`;
}

function locationLabel(match: Match): string {
  const location = match.location?.trim();
  return location === undefined || location === "" ? "не указано" : location;
}

function timeLabel(match: Match, timezone: string): string {
  if (matchTimeMode(match) !== "availability") return "";
  if (match.selectedTime === null || match.selectedTime === undefined) return "выбираем по доступности";
  return match.scheduledAt === null
    ? match.selectedTime
    : formatTimeInTimeZone(match.scheduledAt, timezone);
}

function titleWithoutLegacyDetails(match: Match, title: string): string {
  const location = match.location?.trim();
  const price = match.fieldPriceRubles;
  const priceLabel = price === null ? undefined : `${price} рублей`;
  const details = [location, priceLabel].filter(
    (value): value is string => value !== undefined && value !== "",
  );
  const suffix = details.length === 0
    ? ""
    : priceLabel === undefined
      ? ` — ${details[0]}`
      : ` (${details.join(", ")})`;
  return suffix !== "" && title.endsWith(suffix) ? title.slice(0, -suffix.length).trimEnd() : title;
}

/** Formats the date/time title using the configured calendar timezone. */
export function formatMatchCardTitle(
  match: Match,
  options: MatchCardDisplayOptions = {},
): string {
  const storedTitle = match.title?.trim() || `Матч #v${String(match.id)}`;
  if (
    matchTimeMode(match) === "availability"
    && (match.selectedTime === null || match.selectedTime === undefined)
    && match.scheduleDate !== null
    && match.scheduleDate !== undefined
  ) {
    try {
      const date = new Date(`${match.scheduleDate}T12:00:00.000Z`);
      const formatted = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
      return `${formatted} · время выбираем`;
    } catch {
      return titleWithoutLegacyDetails(match, storedTitle);
    }
  }
  if (match.scheduledAt === null) return titleWithoutLegacyDetails(match, storedTitle);

  const timezone = options.timezone ?? DEFAULT_MATCH_CARD_TIMEZONE;
  try {
    const now = options.now ?? new Date();
    const scheduledDate = calendarDateInTimeZone(match.scheduledAt, timezone);
    const currentDate = calendarDateInTimeZone(now, timezone);
    const time = formatTimeInTimeZone(match.scheduledAt, timezone);
    return scheduledDate === currentDate
      ? `Сегодня ${time}`
      : `${formatDateInTimeZone(match.scheduledAt, timezone)} ${time}`;
  } catch {
    return titleWithoutLegacyDetails(match, storedTitle);
  }
}

function statusLabel(match: Match, goingCount: number): string {
  const planningStage = deriveMatchPlanningStage(match, goingCount);
  if (planningStage !== null) return matchPlanningStageLabel(planningStage);
  switch (match.status) {
    case "active":
      return "Набираем игроков";
    case "confirmed":
      return "Матч состоится ✅";
    case "completed":
      return "Завершён";
    case "cancelled":
      return "Отменён";
    case "draft":
      return "Черновик";
  }
}

function statusLine(match: Match, goingCount: number): string {
  const label = statusLabel(match, goingCount);
  return match.status === "confirmed" ? `Статус: <b>${label}</b>` : `Статус: ${label}`;
}

function optionHeading(option: VoteOption): string {
  switch (option) {
    case "going":
      return "Участвуют";
    case "maybe":
      return "Под вопросом";
    case "not_going":
      return "Не смогут";
  }
}

function venueLabel(venueType: Match["venueType"]): string {
  switch (venueType) {
    case "outdoor":
      return "на улице";
    case "indoor":
      return "в здании";
    default:
      return "не указан";
  }
}

function participantHtml(vote: Vote): string {
  const plainName = truncatePlainText(vote.displayNameSnapshot.trim() || "Игрок", 512);
  const name = escapeHtml(plainName);
  const username = vote.usernameSnapshot?.trim().replace(/^@+/u, "");
  if (username !== undefined && username !== "") {
    return `${name} (@${escapeHtml(truncatePlainText(username, 320))})`;
  }
  return `<a href="tg://user?id=${escapePlainTextId(vote.telegramUserId)}">${name}</a>`;
}

function escapePlainTextId(value: string | number | bigint): string {
  return escapeHtml(String(value));
}

function namedExternalParticipantLines(
  participants: readonly ExternalParticipant[],
  matchId: Match["id"],
): string[] {
  return groupExternalParticipants(participants, matchId)
    .map(({ label, quantity }) => {
      const truncatedLabel = truncatePlainText(label, 512);
      const sourceLabel = /^от(?:\s|$)/iu.test(truncatedLabel)
        ? truncatedLabel.replace(/^от/iu, "От")
        : `От ${truncatedLabel}`;
      return `${escapeHtml(sourceLabel)}: ${quantity}`;
    });
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/gu, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"');
}

function currentLength(lines: readonly string[]): number {
  return lines.join("\n").length;
}

function appendLine(
  lines: string[],
  line: string,
  maxLength: number,
  options: { readonly allowTruncate?: boolean } = {},
): boolean {
  const separatorLength = lines.length === 0 ? 0 : 1;
  const available = maxLength - currentLength(lines) - separatorLength;
  if (available <= 0) return false;
  if (line.length <= available) {
    lines.push(line);
    return true;
  }
  if (options.allowTruncate === false) return false;
  const shortened = escapedTextWithinLimit(stripMarkup(line), available);
  if (shortened === "") return false;
  lines.push(shortened);
  return true;
}

function addParticipantSection(
  lines: string[],
  votes: readonly Vote[],
  option: VoteOption,
  maxLength: number,
  isLast: boolean,
): void {
  const participants = votes.filter((vote) => vote.option === option);
  addVoteListSection(lines, participants, optionHeading(option), option === "going", maxLength, isLast);
}

function addVoteListSection(
  lines: string[],
  participants: readonly Vote[],
  label: string,
  boldHeading: boolean,
  maxLength: number,
  isLast: boolean,
): void {
  const heading = `${label} (${participants.length})`;
  appendLine(lines, boldHeading ? `<b>${heading}</b>` : heading, maxLength);

  let shown = 0;
  for (const participant of participants) {
    const line = `${shown + 1}. ${participantHtml(participant)}`;
    if (!appendLine(lines, line, maxLength, { allowTruncate: false })) break;
    shown += 1;
  }

  if (shown < participants.length) appendLine(lines, `<i>… ещё ${participants.length - shown}</i>`, maxLength);
  if (!isLast && participants.length > 0) appendLine(lines, "", maxLength);
}

function addAvailabilityParticipantSections(
  lines: string[],
  match: Match,
  votes: readonly Vote[],
  maxLength: number,
): void {
  const options = match.timeOptions ?? [];
  for (const [index, time] of options.entries()) {
    const participants = votes.filter((vote) => vote.option === "going" && vote.availableAfter === time);
    const selected = match.selectedTime === time;
    appendLine(
      lines,
      `${selected ? "✅ " : ""}<b>После ${escapeHtml(time)} (${participants.length})</b>`,
      maxLength,
    );
    let shown = 0;
    for (const participant of participants) {
      if (!appendLine(lines, `${shown + 1}. ${participantHtml(participant)}`, maxLength, { allowTruncate: false })) break;
      shown += 1;
    }
    if (shown < participants.length) appendLine(lines, `<i>… ещё ${participants.length - shown}</i>`, maxLength);
    if (participants.length > 0 && index < options.length - 1) appendLine(lines, "", maxLength);
  }
}

function validateMaxLength(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > TELEGRAM_MAX_MESSAGE_LENGTH) {
    throw new Error(`maxLength must be an integer from 1 to ${TELEGRAM_MAX_MESSAGE_LENGTH}`);
  }
}

export function renderMatchCard(
  data: MatchCardData,
  displayOptions: MatchCardDisplayOptions = {},
): MatchCardView {
  const maxLength = displayOptions.maxLength ?? TELEGRAM_MAX_MESSAGE_LENGTH;
  validateMaxLength(maxLength);
  const { match, votes, externalParticipants = [] } = data;
  const externalCount = data.externalCount ?? totalExternalParticipantQuantity(externalParticipants, match.id);
  if (!Number.isSafeInteger(externalCount) || externalCount < 0) throw new Error("externalCount must be a non-negative safe integer");
  const goingCount = votes.filter((vote) => isVoteEligibleForMatch(match, vote)).length + externalCount;
  const cancellationReason = match.cancellationReason?.trim();
  const title = escapeHtml(truncatePlainText(formatMatchCardTitle(match, displayOptions), 512));
  const lines: string[] = [];
  const baseLines = [
    `#v${String(match.id)}`,
    title,
    "",
    statusLine(match, goingCount),
    ...(cancellationReason === undefined || cancellationReason === ""
      ? []
      : [`Причина отмены: ${escapeHtml(truncatePlainText(cancellationReason, 512))}`]),
    "",
    `📍 Место: ${escapeHtml(truncatePlainText(locationLabel(match), 512))}`,
    `🏠 Формат: ${venueLabel(match.venueType)}, ${playerRangeLabel(match.requiredPlayers)}`,
    `🫰 Сумма: ${fieldPriceLabel(match)}`,
    ...(matchTimeMode(match) === "availability"
      ? [`🕒 Время: ${timeLabel(match, displayOptions.timezone ?? DEFAULT_MATCH_CARD_TIMEZONE)}`]
      : []),
    "",
    `<b>👯 Состав ${goingCount}/${match.requiredPlayers}</b>`,
    ...(externalCount > 0 ? [`Внешние игроки: ${externalCount}`] : []),
  ];
  for (const line of baseLines) appendLine(lines, line, maxLength);
  if (
    matchTimeMode(match) === "availability"
    && (match.selectedTime === null || match.selectedTime === undefined)
    && (match.timeOptions?.length ?? 0) > 0
  ) {
    appendLine(lines, "", maxLength);
    appendLine(lines, "Доступны к времени:", maxLength);
    for (const time of match.timeOptions ?? []) {
      const count = cumulativeAvailabilityCount(votes, time, externalCount);
      appendLine(lines, `К ${escapeHtml(time)} — ${count}/${match.requiredPlayers}`, maxLength);
    }
  }
  if (externalCount > 0) {
    const externalLines = namedExternalParticipantLines(externalParticipants, match.id);
    let shownExternal = 0;
    for (const line of externalLines) {
      if (!appendLine(lines, line, maxLength)) break;
      shownExternal += 1;
    }
    if (shownExternal < externalLines.length) appendLine(lines, `<i>… ещё внешние группы</i>`, maxLength);
  }
  appendLine(lines, "", maxLength);

  if (matchTimeMode(match) === "availability" && (match.selectedTime === null || match.selectedTime === undefined)) {
    addAvailabilityParticipantSections(lines, match, votes, maxLength);
    appendLine(lines, "", maxLength);
  } else if (matchTimeMode(match) === "availability") {
    const eligibleGoing = votes.filter((vote) => isVoteEligibleForMatch(match, vote));
    const unavailableGoing = votes.filter((vote) => vote.option === "going" && !isVoteEligibleForMatch(match, vote));
    addVoteListSection(lines, eligibleGoing, "Участвуют", true, maxLength, false);
    if (unavailableGoing.length > 0) {
      addVoteListSection(lines, unavailableGoing, "Не смогут к выбранному времени", false, maxLength, false);
    }
  } else {
    addParticipantSection(lines, votes, "going", maxLength, false);
  }
  addParticipantSection(lines, votes, "maybe", maxLength, false);
  addParticipantSection(lines, votes, "not_going", maxLength, true);

  return {
    text: lines.join("\n").trim(),
    isActive: match.status === "active" || match.status === "confirmed",
  };
}
