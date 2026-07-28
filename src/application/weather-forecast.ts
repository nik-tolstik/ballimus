import { DateTime } from "luxon";

export const MINSK_TIMEZONE = "Europe/Minsk";
export const MINSK_LATITUDE = 53.9006;
export const MINSK_LONGITUDE = 27.559;

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const HOURLY_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
] as const;

export interface WeatherForecast {
  forecastTime: string;
  temperatureCelsius: number;
  apparentTemperatureCelsius: number;
  precipitationProbability: number;
  precipitationMillimetres: number;
  weatherCode: number;
  windSpeedMetresPerSecond: number;
  windGustsMetresPerSecond: number;
}

export interface WeatherForecastClient {
  forecastAt(scheduledAt: Date): Promise<WeatherForecast>;
}

export interface WeatherFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type WeatherFetch = (url: string) => Promise<WeatherFetchResponse>;

export class WeatherForecastError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WeatherForecastError";
  }
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WeatherForecastError(`${context} is missing or malformed`);
  }
  return value as Record<string, unknown>;
}

function arrayField(
  value: Record<string, unknown>,
  field: string,
): readonly unknown[] {
  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    throw new WeatherForecastError(`Open-Meteo response is missing hourly.${field}`);
  }
  return candidate;
}

function numberAt(values: readonly unknown[], index: number, field: string): number {
  const value = values[index];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherForecastError(`Open-Meteo response has no numeric ${field} forecast`);
  }
  return value;
}

function hourlyForecastTime(scheduledAt: Date): { date: string; hour: string } {
  const local = DateTime.fromJSDate(scheduledAt, { zone: MINSK_TIMEZONE });
  const date = local.toISODate();
  if (!local.isValid || date === null) {
    throw new WeatherForecastError("The scheduled match time is invalid");
  }

  return {
    date,
    hour: local.toFormat("yyyy-MM-dd'T'HH:00"),
  };
}

function parseForecast(payload: unknown, targetHour: string): WeatherForecast {
  const root = record(payload, "Open-Meteo response");
  const hourly = record(root.hourly, "Open-Meteo hourly forecast");
  const times = arrayField(hourly, "time");
  const index = times.findIndex((value) => value === targetHour);
  if (index === -1) {
    throw new WeatherForecastError(`Open-Meteo response has no forecast for ${targetHour}`);
  }

  return {
    forecastTime: targetHour,
    temperatureCelsius: numberAt(arrayField(hourly, "temperature_2m"), index, "temperature"),
    apparentTemperatureCelsius: numberAt(
      arrayField(hourly, "apparent_temperature"),
      index,
      "apparent temperature",
    ),
    precipitationProbability: numberAt(
      arrayField(hourly, "precipitation_probability"),
      index,
      "precipitation probability",
    ),
    precipitationMillimetres: numberAt(
      arrayField(hourly, "precipitation"),
      index,
      "precipitation",
    ),
    weatherCode: numberAt(arrayField(hourly, "weather_code"), index, "weather code"),
    windSpeedMetresPerSecond: numberAt(
      arrayField(hourly, "wind_speed_10m"),
      index,
      "wind speed",
    ),
    windGustsMetresPerSecond: numberAt(
      arrayField(hourly, "wind_gusts_10m"),
      index,
      "wind gusts",
    ),
  };
}

/** Retrieves an hourly weather forecast for Minsk from Open-Meteo. */
export class OpenMeteoWeatherForecastClient implements WeatherForecastClient {
  public constructor(private readonly fetch: WeatherFetch = globalThis.fetch) {}

  public async forecastAt(scheduledAt: Date): Promise<WeatherForecast> {
    const target = hourlyForecastTime(scheduledAt);
    const query = new URLSearchParams({
      latitude: String(MINSK_LATITUDE),
      longitude: String(MINSK_LONGITUDE),
      hourly: HOURLY_FIELDS.join(","),
      timezone: MINSK_TIMEZONE,
      wind_speed_unit: "ms",
      start_date: target.date,
      end_date: target.date,
    });
    let response: WeatherFetchResponse;
    try {
      response = await this.fetch(`${OPEN_METEO_FORECAST_URL}?${query.toString()}`);
    } catch (error) {
      throw new WeatherForecastError("Open-Meteo request failed", { cause: error });
    }
    if (!response.ok) {
      throw new WeatherForecastError(`Open-Meteo request failed with HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new WeatherForecastError("Open-Meteo returned an unreadable response", { cause: error });
    }
    return parseForecast(payload, target.hour);
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function forecastDayLabel(scheduledAt: Date, now: Date): string {
  const scheduled = DateTime.fromJSDate(scheduledAt, { zone: MINSK_TIMEZONE });
  const current = DateTime.fromJSDate(now, { zone: MINSK_TIMEZONE });
  const scheduledDate = scheduled.toISODate();
  if (!scheduled.isValid || scheduledDate === null) {
    throw new WeatherForecastError("The scheduled match time is invalid");
  }
  if (!current.isValid) {
    throw new WeatherForecastError("The forecast reference time is invalid");
  }

  if (scheduledDate === current.toISODate()) return "сегодня";
  if (scheduledDate === current.plus({ days: 1 }).toISODate()) return "завтра";
  return scheduled.toFormat("dd.LL.yyyy");
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

export function formatWeatherForecastNotification(
  forecast: WeatherForecast,
  scheduledAt: Date,
  now: Date = new Date(),
): string {
  return [
    `<b>Прогноз погоды на ${forecastDayLabel(scheduledAt, now)} в Минске</b>`,
    `🌡 ${formatNumber(forecast.temperatureCelsius)} °C, ощущается как ${formatNumber(forecast.apparentTemperatureCelsius)} °C, ${weatherDescription(forecast.weatherCode)}.`,
    `🌧 Осадки: ${formatNumber(forecast.precipitationProbability)}% (${formatNumber(forecast.precipitationMillimetres)} мм)`,
    `🍃 Ветер: ${formatNumber(forecast.windSpeedMetresPerSecond)} м/с`,
    `🌪 Порывы: ${formatNumber(forecast.windGustsMetresPerSecond)} м/с`,
  ].join("\n");
}

export function weatherForecastTransitionKey(chatId: number, scheduledAt: Date): string {
  const local = DateTime.fromJSDate(scheduledAt, { zone: MINSK_TIMEZONE });
  const date = local.toISODate();
  if (!local.isValid || date === null) {
    throw new WeatherForecastError("The scheduled match time is invalid");
  }

  return `forecast:${chatId}:${date}`;
}
