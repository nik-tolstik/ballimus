import type { CurrentWeather } from "./types.js";

export const MINSK_LATITUDE = 53.9006;
export const MINSK_LONGITUDE = 27.559;

export class WeatherError extends Error {
  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "WeatherError";
  }
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WeatherError(`${context} is missing or malformed`);
  }
  return value as Record<string, unknown>;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const candidate = value[field];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new WeatherError(`Open-Meteo response has no numeric current.${field}`);
  }
  return candidate;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new WeatherError(`Open-Meteo response has no current.${field}`);
  }
  return candidate;
}

/** Parses current Open-Meteo conditions without HTTP concerns. */
export function parseOpenMeteoCurrentWeather(payload: unknown): CurrentWeather {
  const root = record(payload, "Open-Meteo response");
  const current = record(root["current"], "Open-Meteo current conditions");
  return {
    observedAt: stringField(current, "time"),
    temperatureCelsius: numberField(current, "temperature_2m"),
    apparentTemperatureCelsius: numberField(current, "apparent_temperature"),
    precipitationMillimetres: numberField(current, "precipitation"),
    weatherCode: numberField(current, "weather_code"),
    windSpeedMetresPerSecond: numberField(current, "wind_speed_10m"),
    windGustsMetresPerSecond: numberField(current, "wind_gusts_10m"),
  };
}

export function weatherDescription(weatherCode: number): string {
  switch (weatherCode) {
    case 0: return "ясно";
    case 1: return "преимущественно ясно";
    case 2: return "переменная облачность";
    case 3: return "пасмурно";
    case 45:
    case 48: return "туман";
    case 51:
    case 53:
    case 55: return "морось";
    case 56:
    case 57: return "ледяная морось";
    case 61:
    case 63:
    case 65: return "дождь";
    case 66:
    case 67: return "ледяной дождь";
    case 71:
    case 73:
    case 75:
    case 77: return "снег";
    case 80:
    case 81:
    case 82: return "ливень";
    case 85:
    case 86: return "снегопад";
    case 95:
    case 96:
    case 99: return "гроза";
    default: return "неизвестные погодные условия";
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new WeatherError("Weather values must be finite numbers");
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

/** Formats a standalone current-weather Telegram message for Minsk. */
export function formatCurrentWeatherMessage(weather: CurrentWeather): string {
  return [
    "<b>Погода сейчас в Минске</b>",
    `🌡 ${formatNumber(weather.temperatureCelsius)} °C, ощущается как ${formatNumber(weather.apparentTemperatureCelsius)} °C, ${weatherDescription(weather.weatherCode)}.`,
    `🌧 Осадки: ${formatNumber(weather.precipitationMillimetres)} мм`,
    `🍃 Ветер: ${formatNumber(weather.windSpeedMetresPerSecond)} м/с`,
    `🌪 Порывы: ${formatNumber(weather.windGustsMetresPerSecond)} м/с`,
  ].join("\n");
}
