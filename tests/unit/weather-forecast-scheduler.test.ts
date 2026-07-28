import { describe, expect, it } from "vitest";

import type { Match } from "../../src/db/schema.js";
import type { WeatherForecast } from "../../src/application/weather-forecast.js";
import {
  WEATHER_FORECAST_LEAD_TIME_MS,
  WeatherForecastScheduler,
  type WeatherForecastNotificationStore,
} from "../../src/scheduler/weather-forecast-scheduler.js";

const chatId = -100123;
const scheduledAt = new Date("2026-08-02T17:00:00.000Z");
const now = new Date(scheduledAt.getTime() - WEATHER_FORECAST_LEAD_TIME_MS);

const forecast: WeatherForecast = {
  forecastTime: "2026-08-02T20:00",
  temperatureCelsius: 18.5,
  apparentTemperatureCelsius: 17.1,
  precipitationProbability: 40,
  precipitationMillimetres: 0.4,
  weatherCode: 61,
  windSpeedMetresPerSecond: 4.5,
  windGustsMetresPerSecond: 7.2,
};

function match(
  id: number,
  status: Match["status"],
  time: Date | null = scheduledAt,
  venueType: Match["venueType"] = "outdoor",
): Match {
  return {
    id,
    chatId,
    scheduledAt: time,
    location: "Ракета",
    venueType,
    fieldPriceRubles: null,
    title: "02.08.2026 20:00 — Ракета",
    requiredPlayers: 10,
    status,
    cancellationReason: null,
    creatorTelegramUserId: 9,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-20T00:00:00.000Z"),
  };
}

function notificationStore(): WeatherForecastNotificationStore & { keys: Set<string> } {
  let nextId = 1;
  const claims = new Map<number, string>();
  const keys = new Set<string>();
  return {
    keys,
    claim: ({ transitionKey }) => {
      const key = transitionKey;
      if (keys.has(key)) return undefined;
      keys.add(key);
      const id = nextId;
      nextId += 1;
      claims.set(id, key);
      return { id };
    },
    delete: (id) => {
      const key = claims.get(id);
      if (key === undefined) return false;
      keys.delete(key);
      claims.delete(id);
      return true;
    },
  };
}

describe("weather forecast scheduler", () => {
  it("notifies due outdoor active and confirmed matches once per Minsk day", async () => {
    const store = notificationStore();
    const messages: string[] = [];
    const active = match(1, "active");
    const confirmed = match(2, "confirmed", new Date(scheduledAt.getTime() + 60 * 60 * 1000));
    const indoor = match(3, "active", scheduledAt, "indoor");
    const unknownVenue = match(4, "confirmed", scheduledAt, null);
    const draft = match(5, "draft");
    const cancelled = match(6, "cancelled");
    let forecastCalls = 0;
    const scheduler = new WeatherForecastScheduler({
      chatId,
      repositories: {
        matches: {
          listScheduledBetween: () => [confirmed, indoor, unknownVenue, draft, cancelled, active],
        },
        weatherNotifications: store,
      },
      notifier: { send: async (text) => { messages.push(text); } },
      forecastClient: {
        forecastAt: async () => {
          forecastCalls += 1;
          return forecast;
        },
      },
      now: () => new Date(scheduledAt.getTime() - 15 * 60 * 60 * 1000),
    });

    await expect(scheduler.runDueForecasts()).resolves.toEqual({
      dueMatchIds: [1, 2],
      sentMatchIds: [1],
      skippedBecauseRunning: false,
    });
    await scheduler.runDueForecasts();

    expect(messages).toHaveLength(1);
    expect(forecastCalls).toBe(1);
    expect(store.keys.size).toBe(1);
  });

  it("retries a later tick when delivery fails", async () => {
    const store = notificationStore();
    let shouldFail = true;
    let calls = 0;
    const scheduler = new WeatherForecastScheduler({
      chatId,
      repositories: {
        matches: { listScheduledBetween: () => [match(1, "active")] },
        weatherNotifications: store,
      },
      notifier: {
        send: async () => {
          calls += 1;
          if (shouldFail) throw new Error("Telegram unavailable");
        },
      },
      forecastClient: { forecastAt: async () => forecast },
      now: () => now,
      onError: () => undefined,
    });

    await expect(scheduler.runDueForecasts()).resolves.toMatchObject({ sentMatchIds: [] });
    expect(store.keys.size).toBe(0);

    shouldFail = false;
    await expect(scheduler.runDueForecasts()).resolves.toMatchObject({ sentMatchIds: [1] });
    expect(calls).toBe(2);
    expect(store.keys.size).toBe(1);
  });

  it("does not send before the 16-hour window or after the match has started", async () => {
    const store = notificationStore();
    const messages: string[] = [];
    const scheduler = new WeatherForecastScheduler({
      chatId,
      repositories: {
        matches: { listScheduledBetween: () => [match(1, "active")] },
        weatherNotifications: store,
      },
      notifier: { send: async (text) => { messages.push(text); } },
      forecastClient: { forecastAt: async () => forecast },
      now: () => new Date(now.getTime() - 1),
    });

    await scheduler.runDueForecasts();
    expect(messages).toHaveLength(0);

    const afterMatch = new WeatherForecastScheduler({
      chatId,
      repositories: {
        matches: { listScheduledBetween: () => [match(1, "active")] },
        weatherNotifications: store,
      },
      notifier: { send: async (text) => { messages.push(text); } },
      forecastClient: { forecastAt: async () => forecast },
      now: () => scheduledAt,
    });
    await afterMatch.runDueForecasts();
    expect(messages).toHaveLength(0);
  });
});
