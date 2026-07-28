import { DateTime } from "luxon";

import type { ExternalParticipant, Match, Vote, VoteOption } from "../db/schema.js";
import { groupExternalParticipants } from "./external-participants.js";

export interface MatchCardData {
  match: Match;
  votes: readonly Vote[];
  externalCount: number;
  externalParticipants?: readonly ExternalParticipant[];
}

export interface MatchCardDisplayOptions {
  timezone?: string;
  now?: Date;
}

export interface MatchCardView {
  text: string;
  isActive: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const DEFAULT_MATCH_CARD_TIMEZONE = "Europe/Minsk";

function fieldPriceLabel(match: Match): string {
  const fieldPriceRubles = match.fieldPriceRubles;
  return fieldPriceRubles === null || fieldPriceRubles === undefined
    ? "не указана"
    : `${fieldPriceRubles} рублей`;
}

function playerRangeLabel(requiredPlayers: number): string {
  return `${requiredPlayers}-${requiredPlayers + 2} человек`;
}

function locationLabel(match: Match): string {
  const location = match.location?.trim();
  return location === undefined || location === "" ? "не указано" : location;
}

function titleWithoutLegacyDetails(match: Match, title: string): string {
  const location = match.location?.trim();
  const price = match.fieldPriceRubles;
  const priceLabel = price === null || price === undefined ? undefined : `${price} рублей`;
  const details = [location, priceLabel].filter(
    (value): value is string => value !== undefined && value !== "",
  );
  const suffix =
    details.length === 0
      ? ""
      : priceLabel === undefined
        ? ` — ${details[0]}`
        : ` (${details.join(", ")})`;

  return suffix !== "" && title.endsWith(suffix) ? title.slice(0, -suffix.length).trimEnd() : title;
}

/** Formats the date and time line that appears at the top of a public match card. */
export function formatMatchCardTitle(
  match: Match,
  options: MatchCardDisplayOptions = {},
): string {
  const storedTitle = match.title?.trim() || `Матч #v${match.id}`;
  if (match.scheduledAt === null) {
    return titleWithoutLegacyDetails(match, storedTitle);
  }

  const timezone = options.timezone ?? DEFAULT_MATCH_CARD_TIMEZONE;
  const scheduledAt = DateTime.fromJSDate(match.scheduledAt, { zone: timezone });
  if (!scheduledAt.isValid) return titleWithoutLegacyDetails(match, storedTitle);

  const now = DateTime.fromJSDate(options.now ?? new Date(), { zone: timezone });
  const time = scheduledAt.toFormat("HH:mm");
  if (now.isValid && scheduledAt.toISODate() === now.toISODate()) {
    return `Сегодня ${time}`;
  }

  return `${scheduledAt.toFormat("dd.LL.yyyy")} ${time}`;
}

function participantHtml(vote: Vote): string {
  const name = escapeHtml(vote.displayNameSnapshot.trim() || "Игрок");
  const username = vote.usernameSnapshot?.trim().replace(/^@+/, "");
  if (username !== undefined && username !== "") {
    return `${name} (@${escapeHtml(username)})`;
  }

  return `<a href="tg://user?id=${vote.telegramUserId}">${name}</a>`;
}

function statusLabel(status: Match["status"]): string {
  switch (status) {
    case "active":
      return "Голосуем";
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

function statusLine(status: Match["status"]): string {
  const label = statusLabel(status);
  return status === "confirmed" ? `Статус: <b>${label}</b>` : `Статус: ${label}`;
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

function namedExternalParticipantLines(
  participants: readonly ExternalParticipant[],
): string[] {
  return groupExternalParticipants(participants)
    .map(({ label, quantity }) => `От ${escapeHtml(label)}: ${quantity}`);
}

function addParticipantSection(
  lines: string[],
  votes: readonly Vote[],
  option: VoteOption,
  maxLength: number,
  isLast: boolean,
): void {
  const participants = votes.filter((vote) => vote.option === option);
  const heading = `${optionHeading(option)} (${participants.length})`;
  lines.push(option === "going" ? `<b>${heading}</b>` : heading);

  let shown = 0;
  for (const participant of participants) {
    const line = `${shown + 1}. ${participantHtml(participant)}`;
    const suffix = `\n${line}`;
    if (lines.join("\n").length + suffix.length > maxLength) break;
    lines.push(line);
    shown += 1;
  }

  if (shown < participants.length) {
    lines.push(`<i>… ещё ${participants.length - shown}</i>`);
  }
  if (!isLast && participants.length > 0) {
    lines.push("");
  }
}

export function renderMatchCard(
  data: MatchCardData,
  displayOptions: MatchCardDisplayOptions = {},
): MatchCardView {
  const { match, votes, externalCount, externalParticipants = [] } = data;
  const goingCount = votes.filter((vote) => vote.option === "going").length + externalCount;
  const title = escapeHtml(formatMatchCardTitle(match, displayOptions));
  const cancellationReason = match.cancellationReason?.trim();
  const lines = [
    `#v${match.id}`,
    title,
    "",
    statusLine(match.status),
    ...(cancellationReason === undefined || cancellationReason === ""
      ? []
      : [`Причина отмены: ${escapeHtml(cancellationReason)}`]),
    "",
    `📍 Место: ${escapeHtml(locationLabel(match))}`,
    `🏠 Формат: ${venueLabel(match.venueType)}, ${playerRangeLabel(match.requiredPlayers)}`,
    `🫰 Сумма: ${fieldPriceLabel(match)}`,
    "",
    `<b>👯 Состав ${goingCount}/${match.requiredPlayers}</b>`,
    ...(externalCount > 0 ? [`Внешние игроки: ${externalCount}`] : []),
    ...(externalCount > 0 ? namedExternalParticipantLines(externalParticipants) : []),
    "",
  ];

  addParticipantSection(lines, votes, "going", 3900, false);
  addParticipantSection(lines, votes, "maybe", 3900, false);
  addParticipantSection(lines, votes, "not_going", 3900, true);

  return {
    text: lines.join("\n").trim(),
    isActive: match.status === "active" || match.status === "confirmed",
  };
}
