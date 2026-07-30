import type { Notification, NotificationClaimResult } from "@football/db";
import {
  formatWeatherForecastNotification,
  MINSK_TIMEZONE,
  WEATHER_FORECAST_LEAD_TIME_MS,
  type WeatherForecast,
} from "@football/domain";
import { describe, expect, it, vi } from "vitest";

import type { ApiConfig } from "../config/api-config.js";
import { TelegramEffects } from "../telegram/telegram-effects.js";
import {
  WeatherRunner,
  type WeatherDueMatch,
  type WeatherDueMatchProvider,
  type WeatherForecastProvider,
  type WeatherNotificationRepository,
} from "./weather.runner.js";

const CHAT_ID = -100n;
const CHAT_TOPIC_ID = 42n;
const NOW = new Date("2026-08-02T04:00:00.000Z");

const FORECAST: WeatherForecast = {
  forecastTime: "2026-08-02T23:00",
  temperatureCelsius: 18.5,
  apparentTemperatureCelsius: 16,
  precipitationProbability: 31,
  precipitationMillimetres: 0,
  weatherCode: 3,
  windSpeedMetresPerSecond: 5,
  windGustsMetresPerSecond: 10.6,
};

function config(): ApiConfig {
  return {
    databaseUrl: "postgres://test.invalid/football",
    telegramBotToken: "test-token",
    telegramWebhookSecret: "test-secret",
    telegramOwnerUserId: 1n,
    telegramGroupChatId: CHAT_ID,
    telegramGeneralTopicId: 1n,
    telegramChatTopicId: CHAT_TOPIC_ID,
    telegramMiniAppUrl: "https://example.test/mini-app",
    webOrigin: "https://example.test",
    groupTimezone: MINSK_TIMEZONE,
    logLevel: "info",
    port: 3000,
    miniAppInitDataMaxAgeSeconds: 86_400,
  };
}

function notification(id: bigint, overrides: Partial<Notification> = {}): Notification {
  return {
    id,
    matchId: null,
    telegramChatId: CHAT_ID,
    notificationType: "weather_forecast",
    transitionKey: "forecast:-100:2026-08-02",
    weatherDay: "2026-08-02",
    deliveryState: "pending",
    payload: {},
    sentAt: null,
    uncertainAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function weatherMatch(
  id: bigint,
  scheduledAt: Date | null,
  overrides: Partial<WeatherDueMatch> = {},
): WeatherDueMatch {
  return {
    id,
    chatId: CHAT_ID,
    status: "active",
    venueType: "outdoor",
    scheduledAt,
    ...overrides,
  };
}

function createHarness(
  dueMatches: readonly WeatherDueMatch[],
  options: {
    readonly claimResult?: NotificationClaimResult;
    readonly sendError?: Error;
  } = {},
) {
  const listDueMatches = vi.fn<WeatherDueMatchProvider["listDueMatches"]>().mockResolvedValue(dueMatches);
  const getForecast = vi.fn<WeatherForecastProvider["getForecast"]>().mockResolvedValue(FORECAST);
  const claimWeatherForecastDay = vi
    .fn<WeatherNotificationRepository["claimWeatherForecastDay"]>()
    .mockResolvedValue(options.claimResult ?? { status: "claimed", notification: notification(1n) });
  const markSent = vi
    .fn<WeatherNotificationRepository["markSent"]>()
    .mockImplementation(async (id, sentAt, payload) => notification(id, {
      deliveryState: "sent",
      sentAt: sentAt ?? NOW,
      payload: payload ?? {},
    }));
  const markFailed = vi
    .fn<WeatherNotificationRepository["markFailed"]>()
    .mockImplementation(async (id, error, failedAt) => notification(id, {
      deliveryState: "failed",
      lastError: error,
      updatedAt: failedAt ?? NOW,
    }));
  const sendMessage = vi.fn<TelegramEffects["sendMessage"]>();
  if (options.sendError === undefined) {
    sendMessage.mockResolvedValue({ messageId: 99n });
  } else {
    sendMessage.mockRejectedValue(options.sendError);
  }

  const dueProvider: WeatherDueMatchProvider = { listDueMatches };
  const forecastProvider: WeatherForecastProvider = { getForecast };
  const notificationRepository: WeatherNotificationRepository = {
    claimWeatherForecastDay,
    markSent,
    markFailed,
  };
  const effects = { sendMessage };
  const runner = new WeatherRunner(
    config(),
    dueProvider,
    forecastProvider,
    notificationRepository,
    effects as unknown as TelegramEffects,
  );

  return {
    runner,
    listDueMatches,
    getForecast,
    claimWeatherForecastDay,
    markSent,
    markFailed,
    sendMessage,
  };
}

describe("WeatherRunner", () => {
  it("declares the concrete Nest injection token for Telegram effects", () => {
    const dependencies = Reflect.getMetadata("self:paramtypes", WeatherRunner) as
      | readonly { readonly index: number; readonly param: unknown }[]
      | undefined;

    expect(dependencies).toEqual(expect.arrayContaining([
      { index: 4, param: TelegramEffects },
    ]));
  });

  it.each(["active", "confirmed"] as const)(
    "claims an outdoor %s match exactly at the 16-hour boundary",
    async (status) => {
      const scheduledAt = new Date(NOW.getTime() + WEATHER_FORECAST_LEAD_TIME_MS);
      const harness = createHarness([weatherMatch(1n, scheduledAt, { status })]);

      const result = await harness.runner.runOnce(NOW);

      expect(result).toEqual({ candidates: 1, claimed: 1, duplicates: 0, sent: 1, failed: 0, skipped: 0 });
      expect(harness.claimWeatherForecastDay).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects outdoor matches before the window and after their scheduled time", async () => {
    const harness = createHarness([
      weatherMatch(1n, new Date(NOW.getTime() + WEATHER_FORECAST_LEAD_TIME_MS + 1)),
      weatherMatch(2n, new Date(NOW.getTime() - 1)),
    ]);

    const result = await harness.runner.runOnce(NOW);

    expect(result).toEqual({ candidates: 0, claimed: 0, duplicates: 0, sent: 0, failed: 0, skipped: 2 });
    expect(harness.claimWeatherForecastDay).not.toHaveBeenCalled();
    expect(harness.getForecast).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects indoor and untimed matches without claiming them", async () => {
    const harness = createHarness([
      weatherMatch(1n, new Date(NOW.getTime() + WEATHER_FORECAST_LEAD_TIME_MS), { venueType: "indoor" }),
      weatherMatch(2n, null),
    ]);

    const result = await harness.runner.runOnce(NOW);

    expect(result).toEqual({ candidates: 0, claimed: 0, duplicates: 0, sent: 0, failed: 0, skipped: 2 });
    expect(harness.claimWeatherForecastDay).not.toHaveBeenCalled();
    expect(harness.getForecast).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });

  it("uses the Europe/Minsk day key and claims only once per chat and day", async () => {
    const now = new Date("2026-08-02T06:00:00.000Z");
    const first = weatherMatch(1n, new Date("2026-08-02T21:00:00.000Z"));
    const second = weatherMatch(2n, new Date("2026-08-02T22:00:00.000Z"), { status: "confirmed" });
    const harness = createHarness([first, second]);

    const result = await harness.runner.runOnce(now);

    expect(result).toEqual({ candidates: 2, claimed: 1, duplicates: 1, sent: 1, failed: 0, skipped: 0 });
    expect(harness.claimWeatherForecastDay).toHaveBeenCalledTimes(1);
    expect(harness.claimWeatherForecastDay).toHaveBeenCalledWith({
      telegramChatId: CHAT_ID,
      weatherDay: "2026-08-03",
      transitionKey: "forecast:-100:2026-08-03",
      claimedAt: now,
    });
  });

  it("does not send when the repository returns a duplicate claim", async () => {
    const existing = notification(8n, { deliveryState: "sent" });
    const harness = createHarness(
      [weatherMatch(1n, new Date(NOW.getTime() + WEATHER_FORECAST_LEAD_TIME_MS))],
      { claimResult: { status: "duplicate", notification: existing } },
    );

    const result = await harness.runner.runOnce(NOW);

    expect(result).toEqual({ candidates: 1, claimed: 0, duplicates: 1, sent: 0, failed: 0, skipped: 0 });
    expect(harness.getForecast).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.markSent).not.toHaveBeenCalled();
    expect(harness.markFailed).not.toHaveBeenCalled();
  });

  it("sends the forecast to the configured topic and marks the claim sent", async () => {
    const scheduledAt = new Date("2026-08-02T20:00:00.000Z");
    const claimed = notification(7n, { payload: { source: "fixture" } });
    const harness = createHarness(
      [weatherMatch(1n, scheduledAt)],
      { claimResult: { status: "claimed", notification: claimed } },
    );
    const expectedText = formatWeatherForecastNotification(FORECAST, scheduledAt, NOW, MINSK_TIMEZONE);

    const result = await harness.runner.runOnce(NOW);

    expect(result).toEqual({ candidates: 1, claimed: 1, duplicates: 0, sent: 1, failed: 0, skipped: 0 });
    expect(harness.sendMessage).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      text: expectedText,
      messageThreadId: CHAT_TOPIC_ID,
    });
    expect(harness.markSent).toHaveBeenCalledWith(7n, NOW, {
      source: "fixture",
      text: expectedText,
      matchId: "1",
      weatherDay: "2026-08-02",
    });
  });

  it("marks the claim failed when sending the forecast fails", async () => {
    const sendError = new Error("Telegram unavailable");
    const harness = createHarness(
      [weatherMatch(1n, new Date(NOW.getTime() + WEATHER_FORECAST_LEAD_TIME_MS))],
      { sendError },
    );

    const result = await harness.runner.runOnce(NOW);

    expect(result).toEqual({ candidates: 1, claimed: 1, duplicates: 0, sent: 0, failed: 1, skipped: 0 });
    expect(harness.markFailed).toHaveBeenCalledWith(1n, "Telegram unavailable", NOW);
    expect(harness.markSent).not.toHaveBeenCalled();
  });
});
