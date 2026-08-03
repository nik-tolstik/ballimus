import { HttpException } from "@nestjs/common";
import type { AppDatabase, Match, MatchesRepository, Notification } from "@football/db";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_OWNER_USER_ID: "77",
    TELEGRAM_CHAT_ID: "-100",
    TELEGRAM_GENERAL_TOPIC_ID: "1",
    TELEGRAM_CHAT_TOPIC_ID: "42",
    TELEGRAM_MINI_APP_URL: "https://example.test/mini-app",
    WEB_ORIGIN: "https://example.test",
    LOG_LEVEL: "info",
  });
});

import type { ApiConfig } from "../config/api-config.js";
import type { WeatherRunner } from "../jobs/weather.runner.js";
import { OwnerRestService } from "./rest.service.js";

const NOW = new Date("2026-08-02T08:00:00.000Z");
const OWNER_ID = 77n;
const CHAT_ID = -100n;

const config: ApiConfig = {
  databaseUrl: "postgres://test.invalid/football",
  telegramBotToken: "test-token",
  telegramWebhookSecret: "test-secret",
  telegramOwnerUserId: OWNER_ID,
  telegramGroupChatId: CHAT_ID,
  telegramGeneralTopicId: 1n,
  telegramChatTopicId: 42n,
  telegramMiniAppUrl: "https://example.test/mini-app",
  webOrigin: "https://example.test",
  groupTimezone: "Europe/Minsk",
  logLevel: "info",
  port: 6000,
  miniAppInitDataMaxAgeSeconds: 86_400,
};

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 1n,
    telegramChatId: CHAT_ID,
    scheduledAt: new Date("2026-08-12T17:00:00.000Z"),
    scheduleDate: "2026-08-12",
    timeMode: "exact",
    timeOptions: [],
    selectedTime: null,
    venueId: null,
    location: "Outdoor field",
    venueType: "outdoor",
    fieldPriceRubles: null,
    title: "Match",
    requiredPlayers: 10,
    status: "active",
    cancellationReason: null,
    creatorTelegramUserId: OWNER_ID,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function notification(payload: Record<string, unknown>): Notification {
  return {
    id: 1n,
    matchId: null,
    telegramChatId: CHAT_ID,
    notificationType: "weather_forecast",
    transitionKey: "forecast:-100:2026-08-12",
    weatherDay: "2026-08-12",
    deliveryState: "sent",
    payload,
    sentAt: NOW,
    uncertainAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function serviceFor(
  record: Match,
  result: Awaited<ReturnType<WeatherRunner["sendForecast"]>>,
): { readonly service: OwnerRestService; readonly sendForecast: ReturnType<typeof vi.fn> } {
  const getById = vi.fn().mockResolvedValue(record);
  const sendForecast = vi.fn().mockResolvedValue(result);
  const service = new OwnerRestService(
    {} as AppDatabase,
    config,
    undefined,
    { sendForecast } as unknown as WeatherRunner,
    { getById } as unknown as MatchesRepository,
  );
  return { service, sendForecast };
}

function errorResponse(error: unknown): unknown {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("manual weather REST action", () => {
  it("sends a future forecast immediately with the manual source", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const sentNotification = notification({ source: "manual", matchId: "1" });
    const { service, sendForecast } = serviceFor(match(), {
      status: "sent",
      notification: sentNotification,
      weatherDay: "2026-08-12",
      text: "Forecast",
    });

    await expect(service.sendWeatherForecast(OWNER_ID, 1n)).resolves.toEqual({
      matchId: "1",
      weatherDay: "2026-08-12",
      status: "sent",
    });
    expect(sendForecast).toHaveBeenCalledWith(expect.objectContaining({ id: 1n }), NOW, "manual");
  });

  it("returns a dedicated warning code for a repeated manual send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { service } = serviceFor(match(), {
      status: "duplicate",
      notification: notification({ source: "manual", matchId: "1" }),
      weatherDay: "2026-08-12",
    });

    try {
      await service.sendWeatherForecast(OWNER_ID, 1n);
      expect.fail("Expected the duplicate manual send to fail");
    } catch (error) {
      expect(errorResponse(error)).toEqual({
        code: "WEATHER_ALREADY_SENT_MANUALLY",
        message: "The owner already sent weather for this day.",
      });
    }
  });

  it("does not call delivery for a match outside the provider forecast window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { service, sendForecast } = serviceFor(
      match({ scheduledAt: new Date("2026-08-20T17:00:00.000Z"), scheduleDate: "2026-08-20" }),
      {
        status: "sent",
        notification: notification({ source: "manual" }),
        weatherDay: "2026-08-20",
        text: "Forecast",
      },
    );

    await expect(service.sendWeatherForecast(OWNER_ID, 1n)).rejects.toBeInstanceOf(HttpException);
    expect(sendForecast).not.toHaveBeenCalled();
  });
});
