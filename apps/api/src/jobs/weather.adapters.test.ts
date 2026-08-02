import type { WeatherForecast } from "@football/domain";
import { describe, expect, it, vi } from "vitest";

import type { ApiConfig } from "../config/api-config.js";
import {
  OPEN_METEO_FORECAST_URL,
  OpenMeteoWeatherForecastProvider,
  WEATHER_PROVIDER_TIMEOUT_MS,
} from "./weather.adapters.js";
import type { WeatherDueMatch } from "./weather.runner.js";

const config: ApiConfig = {
  databaseUrl: "postgres://test.invalid/football",
  telegramBotToken: "test-token",
  telegramWebhookSecret: "test-secret",
  telegramOwnerUserId: 1n,
  telegramGroupChatId: -100n,
  telegramGeneralTopicId: 1n,
  telegramChatTopicId: 42n,
  telegramMiniAppUrl: "https://example.test/mini-app",
  webOrigin: "https://example.test",
  groupTimezone: "Europe/Minsk",
  logLevel: "info",
  port: 3000,
  miniAppInitDataMaxAgeSeconds: 86_400,
};

const scheduledAt = new Date("2026-08-02T20:00:00.000Z");
const match: WeatherDueMatch = {
  id: 1n,
  chatId: -100n,
  status: "active",
  venueType: "outdoor",
  scheduledAt,
};

const payload = {
  hourly: {
    time: ["2026-08-02T23:00"],
    temperature_2m: [18],
    apparent_temperature: [16],
    precipitation_probability: [31],
    precipitation: [0],
    weather_code: [3],
    wind_speed_10m: [5],
    wind_gusts_10m: [10],
  },
};

describe("OpenMeteoWeatherForecastProvider", () => {
  it("performs one bounded request and parses the scheduled local hour", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);
    const provider = new OpenMeteoWeatherForecastProvider(config, fetchImpl);

    const result = await provider.getForecast(match, new Date("2026-08-02T04:00:00.000Z"));

    expect(result).toEqual<WeatherForecast>({
      forecastTime: "2026-08-02T23:00",
      temperatureCelsius: 18,
      apparentTemperatureCelsius: 16,
      precipitationProbability: 31,
      precipitationMillimetres: 0,
      weatherCode: 3,
      windSpeedMetresPerSecond: 5,
      windGustsMetresPerSecond: 10,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(input)).toContain(OPEN_METEO_FORECAST_URL);
    expect(String(input)).toContain("forecast_days=2");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).toMatchObject({});
    expect(WEATHER_PROVIDER_TIMEOUT_MS).toBe(15_000);
  });

  it("turns non-success responses into a retryable error", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);
    const provider = new OpenMeteoWeatherForecastProvider(config, fetchImpl);

    await expect(provider.getForecast(match, new Date())).rejects.toThrow(
      "Open-Meteo request failed with HTTP 503",
    );
  });

  it("requests enough forecast days for an early manual send", async () => {
    const distantMatch = {
      ...match,
      scheduledAt: new Date("2026-08-12T17:00:00.000Z"),
    };
    const fetchImpl = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hourly: {
          ...payload.hourly,
          time: ["2026-08-12T20:00"],
        },
      }),
    } as Response);
    const provider = new OpenMeteoWeatherForecastProvider(config, fetchImpl);

    await provider.getForecast(distantMatch, new Date("2026-08-02T04:00:00.000Z"));

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("forecast_days=11");
  });
});
