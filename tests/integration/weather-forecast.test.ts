import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type WeatherForecast } from "../../src/application/weather-forecast.js";
import { createTestDatabase, type DatabaseClient } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import {
  WEATHER_FORECAST_LEAD_TIME_MS,
  WeatherForecastScheduler,
  createWeatherForecastNotificationStore,
} from "../../src/scheduler/weather-forecast-scheduler.js";

const chatId = -1001234567890;
const scheduledAt = new Date("2026-08-02T17:00:00.000Z");

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

describe("weather forecast persistence", () => {
  let client: DatabaseClient;
  let repositories: Repositories;

  beforeEach(() => {
    client = createTestDatabase();
    repositories = createRepositories(client.db);
    repositories.chatSettings.create({
      chatId,
      generalTopicId: 1,
      chatTopicId: 42,
      timezone: "Europe/Minsk",
      defaultThreshold: 10,
    });
  });

  afterEach(() => {
    client.close();
  });

  it("persists one daily forecast for multiple outdoor matches", async () => {
    const firstMatch = repositories.matches.create({
      chatId,
      scheduledAt,
      location: "Ракета",
      venueType: "outdoor",
      requiredPlayers: 10,
      creatorTelegramUserId: 7,
      status: "active",
    });
    const secondMatch = repositories.matches.create({
      chatId,
      scheduledAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
      location: "Стадион",
      venueType: "outdoor",
      requiredPlayers: 10,
      creatorTelegramUserId: 7,
      status: "confirmed",
    });
    const messages: string[] = [];
    const scheduler = new WeatherForecastScheduler({
      chatId,
      repositories: {
        matches: repositories.matches,
        weatherNotifications: createWeatherForecastNotificationStore(repositories.notifications),
      },
      notifier: { send: async (text) => { messages.push(text); } },
      forecastClient: { forecastAt: async () => forecast },
      now: () => new Date(scheduledAt.getTime() - 15 * 60 * 60 * 1000),
    });

    await scheduler.runDueForecasts();
    await scheduler.runDueForecasts();

    expect(messages).toHaveLength(1);
    expect(repositories.notifications.listByMatchId(firstMatch.id)).toMatchObject([
      {
        notificationType: "weather_forecast",
        transitionKey: `forecast:${chatId}:2026-08-02`,
      },
    ]);
    expect(repositories.notifications.listByMatchId(secondMatch.id)).toEqual([]);
  });

  it("does not duplicate a daily forecast after the first match has started", async () => {
    const firstScheduledAt = new Date("2026-08-02T06:00:00.000Z");
    const laterScheduledAt = new Date("2026-08-02T15:00:00.000Z");
    const firstMatch = repositories.matches.create({
      chatId,
      scheduledAt: firstScheduledAt,
      location: "Ракета",
      venueType: "outdoor",
      requiredPlayers: 10,
      creatorTelegramUserId: 7,
      status: "active",
    });
    const laterMatch = repositories.matches.create({
      chatId,
      scheduledAt: laterScheduledAt,
      location: "Стадион",
      venueType: "outdoor",
      requiredPlayers: 10,
      creatorTelegramUserId: 7,
      status: "active",
    });
    const messages: string[] = [];
    let currentNow = new Date(firstScheduledAt.getTime() - WEATHER_FORECAST_LEAD_TIME_MS);
    const scheduler = new WeatherForecastScheduler({
      chatId,
      repositories: {
        matches: repositories.matches,
        weatherNotifications: createWeatherForecastNotificationStore(repositories.notifications),
      },
      notifier: { send: async (text) => { messages.push(text); } },
      forecastClient: { forecastAt: async () => forecast },
      now: () => currentNow,
    });

    await scheduler.runDueForecasts();
    currentNow = new Date("2026-08-02T10:00:00.000Z");
    await scheduler.runDueForecasts();

    expect(messages).toHaveLength(1);
    expect(repositories.notifications.listByMatchId(firstMatch.id)).toHaveLength(1);
    expect(repositories.notifications.listByMatchId(laterMatch.id)).toEqual([]);
  });

  it("skips indoor matches", async () => {
    const indoorMatch = repositories.matches.create({
      chatId,
      scheduledAt,
      location: "Манеж",
      venueType: "indoor",
      requiredPlayers: 10,
      creatorTelegramUserId: 7,
      status: "active",
    });
    const messages: string[] = [];
    let forecastCalls = 0;
    const scheduler = new WeatherForecastScheduler({
      chatId,
      repositories: {
        matches: repositories.matches,
        weatherNotifications: createWeatherForecastNotificationStore(repositories.notifications),
      },
      notifier: { send: async (text) => { messages.push(text); } },
      forecastClient: {
        forecastAt: async () => {
          forecastCalls += 1;
          return forecast;
        },
      },
      now: () => new Date(scheduledAt.getTime() - WEATHER_FORECAST_LEAD_TIME_MS),
    });

    await scheduler.runDueForecasts();

    expect(messages).toEqual([]);
    expect(forecastCalls).toBe(0);
    expect(repositories.notifications.listByMatchId(indoorMatch.id)).toEqual([]);
  });
});
