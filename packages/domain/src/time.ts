import { isValidLocalTime } from "./validation.js";

export const MINSK_TIMEZONE = "Europe/Minsk";

export interface ZonedDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${field} must be a valid Date`);
  }
}

function formatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch (error) {
    throw new Error(`Invalid timezone: ${timezone}`, { cause: error });
  }
}

function part(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((candidate) => candidate.type === type)?.value;
  if (value === undefined) throw new Error(`Timezone formatter omitted ${type}`);
  return Number(value);
}

export function getZonedDateParts(value: Date, timezone: string = MINSK_TIMEZONE): ZonedDateParts {
  assertValidDate(value, "date");
  const parts = formatter(timezone).formatToParts(value);
  return {
    year: part(parts, "year"),
    month: part(parts, "month"),
    day: part(parts, "day"),
    hour: part(parts, "hour"),
    minute: part(parts, "minute"),
  };
}

export function calendarDateInTimeZone(value: Date, timezone: string = MINSK_TIMEZONE): string {
  const parts = getZonedDateParts(value, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatDateInTimeZone(value: Date, timezone: string = MINSK_TIMEZONE): string {
  const parts = getZonedDateParts(value, timezone);
  return `${String(parts.day).padStart(2, "0")}.${String(parts.month).padStart(2, "0")}.${String(parts.year).padStart(4, "0")}`;
}

export function formatTimeInTimeZone(value: Date, timezone: string = MINSK_TIMEZONE): string {
  const parts = getZonedDateParts(value, timezone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatLocalDateTime(value: Date, timezone: string = MINSK_TIMEZONE): string {
  return `${formatDateInTimeZone(value, timezone)} ${formatTimeInTimeZone(value, timezone)}`;
}

export function sameCalendarDay(
  left: Date,
  right: Date,
  timezone: string = MINSK_TIMEZONE,
): boolean {
  return calendarDateInTimeZone(left, timezone) === calendarDateInTimeZone(right, timezone);
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function utcMillisFromParts(parts: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}): number {
  const candidate = new Date(0);
  candidate.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  candidate.setUTCHours(parts.hour, parts.minute, 0, 0);
  return candidate.getTime();
}

function timezoneOffsetMillis(value: Date, timezone: string): number {
  const parts = getZonedDateParts(value, timezone);
  return utcMillisFromParts(parts) - value.getTime();
}

/** Converts a local wall-clock value into an instant without a date library. */
export function parseLocalDateTime(
  date: string,
  time: string,
  timezone: string = MINSK_TIMEZONE,
): Date {
  if (!isCalendarDate(date)) throw new Error("date must be a real calendar date in YYYY-MM-DD format");
  if (!isValidLocalTime(time)) throw new Error("time must use HH:mm");
  const [yearText, monthText, dayText] = date.split("-");
  const [hourText, minuteText] = time.split(":");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const localAsUtc = utcMillisFromParts({ year, month, day, hour, minute });
  const firstGuess = new Date(localAsUtc);
  const firstOffset = timezoneOffsetMillis(firstGuess, timezone);
  const secondGuess = new Date(localAsUtc - firstOffset);
  const secondOffset = timezoneOffsetMillis(secondGuess, timezone);
  const result = new Date(localAsUtc - secondOffset);
  const resultParts = getZonedDateParts(result, timezone);
  if (
    resultParts.year !== year ||
    resultParts.month !== month ||
    resultParts.day !== day ||
    resultParts.hour !== hour ||
    resultParts.minute !== minute
  ) {
    throw new Error(`${date} ${time} does not exist in timezone ${timezone}`);
  }
  return result;
}
