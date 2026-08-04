import { groupExternalParticipants, totalExternalParticipantQuantity } from "./external-participants.js";
import { escapeHtml, escapedTextWithinLimit, truncatePlainText } from "./html.js";
import type { ExternalParticipant, Match, Vote, VoteOption } from "./types.js";
import {
  formatLegacyDatePrefix,
  formatTimeInTimeZone,
  formatWeekdayCalendarDate,
  formatWeekdayDateInTimeZone,
  MINSK_TIMEZONE,
} from "./time.js";
import { isTimePollMode, isVoteEligibleForMatch, matchTimeMode } from "./availability.js";
import { deriveMatchPlanningStage } from "./planning-stage.js";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const DEFAULT_MATCH_CARD_TIMEZONE = MINSK_TIMEZONE;

export interface MatchCardData {
  readonly match: Match;
  readonly votes: readonly Vote[];
  /** Saved map link for the selected venue, when one exists. */
  readonly mapUrl?: string | null;
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
  return price === null ? "Стоимость уточняется" : `${price} рублей`;
}

function locationLabel(match: Match): string {
  const location = match.location?.trim();
  return location === undefined || location === "" ? "Место уточняется" : location;
}

function locationLine(match: Match, mapUrl: string | null | undefined): string {
  const location = escapeHtml(truncatePlainText(locationLabel(match), 512));
  const normalizedMapUrl = mapUrl?.trim();
  if (normalizedMapUrl === undefined || normalizedMapUrl === "") {
    return `📍 ${location}`;
  }
  return `📍 ${location}, <i><a href="${escapeHtml(normalizedMapUrl)}">Точка на карте</a></i>`;
}

function timeLabel(match: Match, timezone: string): string {
  if (!isTimePollMode(matchTimeMode(match))) return "";
  if (match.selectedTime === null || match.selectedTime === undefined) {
    return matchTimeMode(match) === "availability"
      ? "Выбираем время по доступности"
      : "Выбираем время из вариантов";
  }
  const selectedTime = match.scheduledAt === null
    ? match.selectedTime
    : formatTimeInTimeZone(match.scheduledAt, timezone);
  return `Выбрано время: ${selectedTime}`;
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
  const titleWithoutDetails = suffix !== "" && title.endsWith(suffix)
    ? title.slice(0, -suffix.length).trimEnd()
    : title;
  return formatLegacyDatePrefix(titleWithoutDetails);
}

/** Formats the date/time title using the configured calendar timezone. */
export function formatMatchCardTitle(
  match: Match,
  options: MatchCardDisplayOptions = {},
): string {
  const storedTitle = match.title?.trim() || `Матч #v${String(match.id)}`;
  if (
    isTimePollMode(matchTimeMode(match))
    && (match.selectedTime === null || match.selectedTime === undefined)
    && match.scheduleDate !== null
    && match.scheduleDate !== undefined
  ) {
    try {
      return `${formatWeekdayCalendarDate(match.scheduleDate)} · время выбираем`;
    } catch {
      return titleWithoutLegacyDetails(match, storedTitle);
    }
  }
  if (match.scheduledAt === null) return titleWithoutLegacyDetails(match, storedTitle);

  const timezone = options.timezone ?? DEFAULT_MATCH_CARD_TIMEZONE;
  try {
    const time = formatTimeInTimeZone(match.scheduledAt, timezone);
    return `${formatWeekdayDateInTimeZone(match.scheduledAt, timezone)} · ${time}`;
  } catch {
    return titleWithoutLegacyDetails(match, storedTitle);
  }
}

function statusLine(match: Match, goingCount: number): string {
  const planningStage = deriveMatchPlanningStage(match, goingCount);
  switch (planningStage) {
    case "recruiting_players":
      return "🟢 <b>Набор открыт</b>";
    case "finalizing_details":
      return "🟡 <b>Состав набран — уточняем время и место</b>";
    case "ready_to_confirm":
      return "🟢 <b>Готов к подтверждению</b>";
    case null:
      break;
  }
  switch (match.status) {
    case "active":
      return "🟢 <b>Набор открыт</b>";
    case "confirmed":
      return "✅ <b>Матч состоится</b>";
    case "completed":
      return "⚪ <b>Матч завершён</b>";
    case "cancelled":
      return "🔴 <b>Матч отменён</b>";
    case "draft":
      return "⚪ <b>Черновик</b>";
  }
}

function remainingPlacesLabel(value: number): string {
  const absolute = value % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return "мест";
  if (last === 1) return "место";
  if (last > 1 && last < 5) return "места";
  return "мест";
}

function rosterProgressLine(goingCount: number, requiredPlayers: number): string {
  const remaining = Math.max(0, requiredPlayers - goingCount);
  return remaining === 0
    ? `👥 <b>${goingCount} из ${requiredPlayers}</b> · состав собран`
    : `👥 <b>${goingCount} из ${requiredPlayers}</b> · осталось ${remaining} ${remainingPlacesLabel(remaining)}`;
}

function optionHeading(option: VoteOption): { readonly icon: string; readonly label: string } {
  switch (option) {
    case "going":
      return { icon: "🟢", label: "Участвуют" };
    case "maybe":
      return { icon: "🟡", label: "Под вопросом" };
    case "not_going":
      return { icon: "🔴", label: "Не смогут" };
  }
}

function venueLabel(venueType: Match["venueType"]): string {
  switch (venueType) {
    case "outdoor":
      return "На улице";
    case "indoor":
      return "В здании";
    default:
      return "Формат уточняется";
  }
}

function participantHtml(vote: Vote): string {
  const plainName = truncatePlainText(vote.displayNameSnapshot.trim() || "Игрок", 512);
  const name = escapeHtml(plainName);
  return `<a href="tg://user?id=${escapePlainTextId(vote.telegramUserId)}">${name}</a>`;
}

function escapePlainTextId(value: string | number | bigint): string {
  return escapeHtml(String(value));
}

function namedExternalParticipantItems(
  participants: readonly ExternalParticipant[],
  matchId: Match["id"],
): string[] {
  return groupExternalParticipants(participants, matchId)
    .flatMap(({ label, quantity }) => {
      const truncatedLabel = truncatePlainText(label, 512);
      const sourceLabel = /^от(?:\s|$)/iu.test(truncatedLabel)
        ? truncatedLabel.replace(/^от/iu, "От")
        : `От ${truncatedLabel}`;
      return Array.from(
        { length: Math.max(0, quantity) },
        (_, index) => `${escapeHtml(sourceLabel)} #${index + 1}`,
      );
    });
}

function participantItems(participants: readonly Vote[]): string[] {
  return participants.map(participantHtml);
}

function isExternalParticipantEligibleForMatch(
  match: Match,
  participant: ExternalParticipant,
): boolean {
  const timeMode = matchTimeMode(match);
  if (timeMode !== "availability" || match.selectedTime === null || match.selectedTime === undefined) {
    return true;
  }
  return participant.availableAfter !== null
    && participant.availableAfter !== undefined
    && participant.availableAfter <= match.selectedTime;
}

function externalParticipantsAtAvailabilityTime(
  participants: readonly ExternalParticipant[],
  time: string,
): ExternalParticipant[] {
  return participants.filter((participant) => participant.availableAfter === time);
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
  if (participants.length === 0) return;
  const heading = optionHeading(option);
  addVoteListSection(lines, participants, heading.label, heading.icon, maxLength, isLast);
}

function addParticipantListLine(
  lines: string[],
  items: readonly string[],
  maxLength: number,
): void {
  let shown = 0;
  let participantList = "";
  for (const [index, item] of items.entries()) {
    const nextParticipantList = participantList === "" ? item : `${participantList}, ${item}`;
    const remainingAfterLine = items.length - index - 1;
    const separatorLength = lines.length === 0 ? 0 : 1;
    const overflowLine = `<i>… ещё ${items.length - shown}</i>`;
    const reservedOverflowLength = remainingAfterLine === 0 ? 0 : overflowLine.length + 1;
    if (currentLength(lines) + separatorLength + nextParticipantList.length + reservedOverflowLength > maxLength) break;
    participantList = nextParticipantList;
    shown += 1;
  }
  if (participantList !== "") lines.push(participantList);
  if (shown < items.length) {
    appendLine(lines, `<i>… ещё ${items.length - shown}</i>`, maxLength, { allowTruncate: false });
  }
}

function addExternalParticipantLines(
  lines: string[],
  participants: readonly ExternalParticipant[],
  matchId: Match["id"],
  maxLength: number,
): void {
  const externalItems = namedExternalParticipantItems(participants, matchId);
  let shown = 0;
  for (const item of externalItems) {
    const line = `• ${item}`;
    const remainingAfterLine = externalItems.length - shown - 1;
    const separatorLength = lines.length === 0 ? 0 : 1;
    const overflowLine = "<i>… ещё внешние группы</i>";
    const reservedOverflowLength = remainingAfterLine === 0 ? 0 : overflowLine.length + 1;
    if (currentLength(lines) + separatorLength + line.length + reservedOverflowLength > maxLength) break;
    lines.push(line);
    shown += 1;
  }
  if (shown < externalItems.length) {
    appendLine(lines, "<i>… ещё внешние группы</i>", maxLength, { allowTruncate: false });
  }
}

function addVoteListSection(
  lines: string[],
  participants: readonly Vote[],
  label: string,
  icon: string,
  maxLength: number,
  isLast: boolean,
): void {
  appendLine(lines, `${icon} <b>${label} · ${participants.length}</b>`, maxLength);
  addParticipantListLine(lines, participantItems(participants), maxLength);
  if (!isLast && participants.length > 0) appendLine(lines, "", maxLength);
}

function addMixedParticipantListSection(
  lines: string[],
  votes: readonly Vote[],
  externalParticipants: readonly ExternalParticipant[],
  matchId: Match["id"],
  label: string,
  icon: string,
  maxLength: number,
  isLast: boolean,
): void {
  const externalItems = namedExternalParticipantItems(externalParticipants, matchId);
  const participantCount = votes.length + externalItems.length;
  if (participantCount === 0) return;
  appendLine(lines, `${icon} <b>${label} · ${participantCount}</b>`, maxLength);
  addParticipantListLine(lines, [...participantItems(votes), ...externalItems], maxLength);
  if (!isLast) appendLine(lines, "", maxLength);
}

function addTimeOptionParticipantSections(
  lines: string[],
  match: Match,
  votes: readonly Vote[],
  externalParticipants: readonly ExternalParticipant[],
  maxLength: number,
): void {
  const options = match.timeOptions ?? [];
  for (const [index, time] of options.entries()) {
    const participants = votes.filter((vote) => vote.option === "going" && (
      matchTimeMode(match) === "exact_options"
        ? vote.exactTimes?.includes(time) === true || vote.availableAfter === time
        : vote.availableAfter === time
    ));
    const externalAtTime = matchTimeMode(match) === "availability"
      ? externalParticipantsAtAvailabilityTime(externalParticipants, time)
      : [];
    const selected = match.selectedTime === time;
    const externalCount = totalExternalParticipantQuantity(externalAtTime, match.id);
    const participantCount = participants.length + externalCount;
    const hasParticipants = participantCount > 0;
    const label = matchTimeMode(match) === "availability"
      ? `Могут после ${escapeHtml(time)}`
      : escapeHtml(time);
    const countLabel = hasParticipants ? String(participantCount) : "пока никого";
    appendLine(
      lines,
      `${selected ? "✅" : hasParticipants ? "🟢" : "⚪"} <b>${label} · ${countLabel}</b>`,
      maxLength,
    );
    addParticipantListLine(
      lines,
      [...participantItems(participants), ...namedExternalParticipantItems(externalAtTime, match.id)],
      maxLength,
    );
    if (index < options.length - 1) appendLine(lines, "", maxLength);
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
  const timeMode = matchTimeMode(match);
  const timeSelectionPending = isTimePollMode(timeMode)
    && (match.selectedTime === null || match.selectedTime === undefined);
  const isAvailabilityPoll = timeMode === "availability";
  const eligibleVoteCount = timeMode === "exact_options"
    && (match.selectedTime === null || match.selectedTime === undefined)
    ? Math.max(0, ...(match.timeOptions ?? []).map(
      (time) => votes.filter((vote) => vote.option === "going" && (
        vote.exactTimes?.includes(time) === true || vote.availableAfter === time
      )).length,
    ))
    : votes.filter((vote) => isVoteEligibleForMatch(match, vote)).length;
  const eligibleExternalParticipants = isAvailabilityPoll && !timeSelectionPending
    ? externalParticipants.filter((participant) => isExternalParticipantEligibleForMatch(match, participant))
    : externalParticipants;
  const eligibleExternalCount = totalExternalParticipantQuantity(eligibleExternalParticipants, match.id);
  const unavailableExternalParticipants = isAvailabilityPoll && !timeSelectionPending
    ? externalParticipants.filter((participant) => !isExternalParticipantEligibleForMatch(match, participant))
    : [];
  const unassignedExternalParticipants = isAvailabilityPoll && timeSelectionPending
    ? externalParticipants.filter((participant) => participant.availableAfter === null || participant.availableAfter === undefined)
    : [];
  const goingCount = eligibleVoteCount + eligibleExternalCount;
  const cancellationReason = match.cancellationReason?.trim();
  const title = escapeHtml(truncatePlainText(formatMatchCardTitle(match, displayOptions), 512));
  const lines: string[] = [];
  const baseLines = [
    `<b>⚽ Матч #v${String(match.id)}</b>`,
    title,
    "",
    statusLine(match, goingCount),
    rosterProgressLine(goingCount, match.requiredPlayers),
    ...(cancellationReason === undefined || cancellationReason === ""
      ? []
      : [`Причина отмены: ${escapeHtml(truncatePlainText(cancellationReason, 512))}`]),
    "",
    locationLine(match, data.mapUrl),
    `🏠 ${venueLabel(match.venueType)}`,
    `💰 ${fieldPriceLabel(match)}`,
    ...(isTimePollMode(timeMode)
      ? [`🕒 ${timeLabel(match, displayOptions.timezone ?? DEFAULT_MATCH_CARD_TIMEZONE)}`]
      : []),
  ];
  for (const line of baseLines) appendLine(lines, line, maxLength);
  appendLine(lines, "", maxLength);

  if (timeSelectionPending) {
    addTimeOptionParticipantSections(lines, match, votes, externalParticipants, maxLength);
    appendLine(lines, "", maxLength);
  } else if (isTimePollMode(timeMode)) {
    const eligibleGoing = votes.filter((vote) => isVoteEligibleForMatch(match, vote));
    const unavailableGoing = votes.filter((vote) => vote.option === "going" && !isVoteEligibleForMatch(match, vote));
    addMixedParticipantListSection(
      lines,
      eligibleGoing,
      eligibleExternalParticipants,
      match.id,
      "Участвуют",
      "🟢",
      maxLength,
      false,
    );
    if (unavailableGoing.length > 0) {
      addVoteListSection(
        lines,
        unavailableGoing,
        timeMode === "availability" ? "Не смогут к выбранному времени" : "Выбрали другое время",
        "🔴",
        maxLength,
        false,
      );
    }
  } else {
    addMixedParticipantListSection(
      lines,
      votes.filter((vote) => vote.option === "going"),
      eligibleExternalParticipants,
      match.id,
      "Участвуют",
      "🟢",
      maxLength,
      false,
    );
  }
  addParticipantSection(lines, votes, "maybe", maxLength, false);
  if (votes.some((vote) => vote.option === "not_going")) {
    addParticipantSection(lines, votes, "not_going", maxLength, true);
  }
  const unavailableExternalCount = totalExternalParticipantQuantity(unavailableExternalParticipants, match.id);
  const unassignedExternalCount = totalExternalParticipantQuantity(unassignedExternalParticipants, match.id);
  if (unassignedExternalCount > 0) {
    appendLine(lines, "", maxLength);
    appendLine(lines, `⚪ <b>Доп. участники · ${unassignedExternalCount} · время не указано</b>`, maxLength);
    addExternalParticipantLines(lines, unassignedExternalParticipants, match.id, maxLength);
  }
  if (unavailableExternalCount > 0) {
    appendLine(lines, "", maxLength);
    appendLine(lines, `🔴 <b>Доп. участники вне выбранного времени · ${unavailableExternalCount}</b>`, maxLength);
    addExternalParticipantLines(lines, unavailableExternalParticipants, match.id, maxLength);
  }

  return {
    text: lines.join("\n").trim(),
    isActive: match.status === "active" || match.status === "confirmed",
  };
}
