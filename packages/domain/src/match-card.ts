import { escapeHtml, truncatePlainText } from "./html.js";
import type { Match, Venue } from "./types.js";
import { formatTimeInTimeZone, formatWeekdayDateInTimeZone, MINSK_TIMEZONE } from "./time.js";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const DEFAULT_MATCH_CARD_TIMEZONE = MINSK_TIMEZONE;

export interface InformationMatchCardData {
  readonly match: Match;
  readonly venue: Venue;
}

function priceLabel(price: number | null): string {
  return price === null ? "Стоимость уточняется" : `${String(price)} рублей`;
}

function venueTypeLabel(type: Venue["venueType"]): string {
  return type === "outdoor" ? "На улице" : "В здании";
}

function durationLabel(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  if (hours === 0) return `${String(minutes)} мин`;
  if (minutes === 0) return `${String(hours)} ч`;
  return `${String(hours)} ч ${String(minutes)} мин`;
}

/** Renders the read-only Telegram card for one scheduled match. */
export function renderInformationMatchCard(
  data: InformationMatchCardData,
  timezone: string = DEFAULT_MATCH_CARD_TIMEZONE,
): string {
  const { match, venue } = data;
  const date = formatWeekdayDateInTimeZone(match.scheduledAt, timezone);
  const time = formatTimeInTimeZone(match.scheduledAt, timezone);
  const name = escapeHtml(truncatePlainText(venue.name, 512));
  const mapUrl = escapeHtml(venue.mapUrl);
  const lines = [
    `${date} · ${time} · ${durationLabel(match.durationMinutes)}`,
    "",
    `📍 ${name}, <i><a href="${mapUrl}">Точка на карте</a></i>`,
    `🏠 ${venueTypeLabel(venue.venueType)}`,
    `💰 ${priceLabel(match.fieldPriceRubles)}`,
  ];
  const text = lines.join("\n");
  if (text.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    throw new Error("Rendered information card exceeds Telegram's message length limit");
  }
  return text;
}
