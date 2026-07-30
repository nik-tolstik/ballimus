import type { Match, MatchId, WeatherForecast } from "./types.js";
import {
  calendarDateInTimeZone,
  getZonedDateParts,
  MINSK_TIMEZONE,
} from "./time.js";

export const MINSK_LATITUDE = 53.9006;
export const MINSK_LONGITUDE = 27.559;
export const WEATHER_FORECAST_LEAD_TIME_MS = 16 * 60 * 60 * 1000;

export class WeatherForecastError extends Error {
  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "WeatherForecastError";
  }
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function weatherForecastTransitionKey(
  chatId: Match["chatId"],
  scheduledAt: Date,
  timezone: string = MINSK_TIMEZONE,
): string {
  if (!validDate(scheduledAt)) throw new WeatherForecastError("The scheduled match time is invalid");
  let date: string;
  try {
    date = calendarDateInTimeZone(scheduledAt, timezone);
  } catch (error) {
    throw new WeatherForecastError("The scheduled match time is invalid", { cause: error });
  }
  return `forecast:${String(chatId)}:${date}`;
}

export interface WeatherForecastEligibilityInput {
  readonly match: Pick<Match, "status" | "venueType" | "scheduledAt" | "chatId">;
  readonly now: Date;
  readonly leadTimeMs?: number;
}

export function isWeatherForecastEligible(input: WeatherForecastEligibilityInput): boolean {
  const { match, now } = input;
  const leadTimeMs = input.leadTimeMs ?? WEATHER_FORECAST_LEAD_TIME_MS;
  if (
    match.venueType !== "outdoor" ||
    (match.status !== "active" && match.status !== "confirmed") ||
    match.scheduledAt === null ||
    !validDate(match.scheduledAt) ||
    !validDate(now) ||
    !Number.isSafeInteger(leadTimeMs) ||
    leadTimeMs < 0
  ) {
    return false;
  }
  const scheduledMillis = match.scheduledAt.getTime();
  const nowMillis = now.getTime();
  return scheduledMillis > nowMillis && nowMillis >= scheduledMillis - leadTimeMs;
}

export function eligibleWeatherForecastMatches(
  matches: readonly Match[],
  now: Date,
  options: { readonly onePerDay?: boolean; readonly leadTimeMs?: number } = {},
): Match[] {
  const candidates = matches
    .filter((match) => isWeatherForecastEligible(
      options.leadTimeMs === undefined ? { match, now } : { match, now, leadTimeMs: options.leadTimeMs },
    ))
    .sort((left, right) => {
      const leftTime = left.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime === rightTime ? String(left.id).localeCompare(String(right.id)) : leftTime - rightTime;
    });
  if (options.onePerDay === false) return candidates;

  const seen = new Set<string>();
  return candidates.filter((match) => {
    if (match.scheduledAt === null) return false;
    const key = weatherForecastTransitionKey(match.chatId, match.scheduledAt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WeatherForecastError(`${context} is missing or malformed`);
  }
  return value as Record<string, unknown>;
}

function arrayField(value: Record<string, unknown>, field: string): readonly unknown[] {
  const candidate = value[field];
  if (!Array.isArray(candidate)) throw new WeatherForecastError(`Open-Meteo response is missing hourly.${field}`);
  return candidate;
}

function numberAt(values: readonly unknown[], index: number, field: string): number {
  const value = values[index];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherForecastError(`Open-Meteo response has no numeric ${field} forecast`);
  }
  return value;
}

function targetForecastHour(scheduledAt: Date, timezone: string): string {
  if (!validDate(scheduledAt)) throw new WeatherForecastError("The scheduled match time is invalid");
  try {
    const parts = getZonedDateParts(scheduledAt, timezone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:00`;
  } catch (error) {
    throw new WeatherForecastError("The scheduled match time is invalid", { cause: error });
  }
}

/** Parses the provider payload while keeping HTTP/fetch concerns in an adapter. */
export function parseOpenMeteoForecast(
  payload: unknown,
  scheduledAt: Date,
  timezone: string = MINSK_TIMEZONE,
): WeatherForecast {
  const targetHour = targetForecastHour(scheduledAt, timezone);
  const root = record(payload, "Open-Meteo response");
  const hourly = record(root["hourly"], "Open-Meteo hourly forecast");
  const times = arrayField(hourly, "time");
  const index = times.findIndex((value) => value === targetHour);
  if (index === -1) throw new WeatherForecastError(`Open-Meteo response has no forecast for ${targetHour}`);
  return {
    forecastTime: targetHour,
    temperatureCelsius: numberAt(arrayField(hourly, "temperature_2m"), index, "temperature"),
    apparentTemperatureCelsius: numberAt(arrayField(hourly, "apparent_temperature"), index, "apparent temperature"),
    precipitationProbability: numberAt(arrayField(hourly, "precipitation_probability"), index, "precipitation probability"),
    precipitationMillimetres: numberAt(arrayField(hourly, "precipitation"), index, "precipitation"),
    weatherCode: numberAt(arrayField(hourly, "weather_code"), index, "weather code"),
    windSpeedMetresPerSecond: numberAt(arrayField(hourly, "wind_speed_10m"), index, "wind speed"),
    windGustsMetresPerSecond: numberAt(arrayField(hourly, "wind_gusts_10m"), index, "wind gusts"),
  };
}

export function weatherDescription(weatherCode: number): string {
  switch (weatherCode) {
    case 0:
      return "ясно";
    case 1:
      return "преимущественно ясно";
    case 2:
      return "переменная облачность";
    case 3:
      return "пасмурно";
    case 45:
    case 48:
      return "туман";
    case 51:
    case 53:
    case 55:
      return "морось";
    case 56:
    case 57:
      return "ледяная морось";
    case 61:
    case 63:
    case 65:
      return "дождь";
    case 66:
    case 67:
      return "ледяной дождь";
    case 71:
    case 73:
    case 75:
    case 77:
      return "снег";
    case 80:
    case 81:
    case 82:
      return "ливень";
    case 85:
    case 86:
      return "снегопад";
    case 95:
      return "гроза";
    case 96:
    case 99:
      return "гроза с градом";
    default:
      return "неизвестные погодные условия";
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new WeatherForecastError("Forecast values must be finite numbers");
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function forecastDayLabel(scheduledAt: Date, now: Date, timezone: string): string {
  if (!validDate(scheduledAt)) throw new WeatherForecastError("The scheduled match time is invalid");
  if (!validDate(now)) throw new WeatherForecastError("The forecast reference time is invalid");
  const scheduledDate = calendarDateInTimeZone(scheduledAt, timezone);
  const currentDate = calendarDateInTimeZone(now, timezone);
  if (scheduledDate === currentDate) return "сегодня";

  const currentParts = getZonedDateParts(now, timezone);
  const tomorrow = new Date(Date.UTC(currentParts.year, currentParts.month - 1, currentParts.day + 1));
  const tomorrowDate = `${String(tomorrow.getUTCFullYear()).padStart(4, "0")}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
  return scheduledDate === tomorrowDate
    ? "завтра"
    : `${scheduledDate.slice(8, 10)}.${scheduledDate.slice(5, 7)}.${scheduledDate.slice(0, 4)}`;
}

export function formatWeatherForecastNotification(
  forecast: WeatherForecast,
  scheduledAt: Date,
  now: Date = new Date(),
  timezone: string = MINSK_TIMEZONE,
): string {
  return [
    `<b>Прогноз погоды на ${forecastDayLabel(scheduledAt, now, timezone)} в Минске</b>`,
    `🌡 ${formatNumber(forecast.temperatureCelsius)} °C, ощущается как ${formatNumber(forecast.apparentTemperatureCelsius)} °C, ${weatherDescription(forecast.weatherCode)}.`,
    `🌧 Осадки: ${formatNumber(forecast.precipitationProbability)}% (${formatNumber(forecast.precipitationMillimetres)} мм)`,
    `🍃 Ветер: ${formatNumber(forecast.windSpeedMetresPerSecond)} м/с`,
    `🌪 Порывы: ${formatNumber(forecast.windGustsMetresPerSecond)} м/с`,
  ].join("\n");
}

export function weatherForecastKeyForMatch(match: Pick<Match, "chatId" | "scheduledAt">): string | null {
  return match.scheduledAt === null ? null : weatherForecastTransitionKey(match.chatId, match.scheduledAt);
}

export type WeatherForecastMatchId = MatchId;
