import "reflect-metadata";

import { describe, expect, it } from "vitest";

import { JobsRunner } from "./jobs.runner.js";
import {
  DatabaseWeatherDueMatchProvider,
  DatabaseWeatherNotificationRepository,
  OpenMeteoWeatherForecastProvider,
  WEATHER_JOB_PROVIDERS,
} from "./weather.adapters.js";
import { WeatherRunner } from "./weather.runner.js";

for (const [name, value] of Object.entries({
  DATABASE_URL: "postgres://test.invalid/football",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  TELEGRAM_OWNER_USER_ID: "1",
    TELEGRAM_CHAT_ID: "-100",
  TELEGRAM_GENERAL_TOPIC_ID: "1",
  TELEGRAM_CHAT_TOPIC_ID: "42",
  TELEGRAM_MINI_APP_URL: "https://example.test/mini-app",
  WEB_ORIGIN: "https://example.test",
  LOG_LEVEL: "info",
})) {
  if (process.env[name] === undefined) process.env[name] = value;
}

const { JobsModule } = await import("./jobs.module.js");

describe("JobsModule", () => {
  it("registers the concrete weather adapters and combined runner", () => {
    const providers = Reflect.getMetadata("providers", JobsModule) as readonly unknown[];

    expect(providers).toEqual(expect.arrayContaining([
      DatabaseWeatherDueMatchProvider,
      DatabaseWeatherNotificationRepository,
      OpenMeteoWeatherForecastProvider,
      WeatherRunner,
      JobsRunner,
      ...WEATHER_JOB_PROVIDERS,
    ]));
  });
});
