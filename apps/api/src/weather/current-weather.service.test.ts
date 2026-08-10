import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiConfig } from "../config/api-config.js";
import type { TelegramEffects } from "../telegram/telegram-effects.js";
import { CurrentWeatherService } from "./current-weather.service.js";

const config: ApiConfig = {
  databaseUrl: "postgresql://local.test/football",
  telegramBotToken: "test-token",
  telegramOwnerUserId: 1n,
  telegramGroupChatId: -100n,
  telegramGeneralTopicId: 1n,
  telegramChatTopicId: 42n,
  telegramMiniAppUrl: "https://mini.example.test",
  telegramWebhookSecret: "test-webhook-secret",
  webOrigin: "https://mini.example.test",
  groupTimezone: "Europe/Minsk",
  logLevel: "debug",
  port: 6000,
  miniAppInitDataMaxAgeSeconds: 86_400,
};

afterEach(() => vi.unstubAllGlobals());

describe("CurrentWeatherService", () => {
  it("fetches Open-Meteo and sends a standalone message to the configured topic", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 10n });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      current: {
        time: "2026-08-10T14:00", temperature_2m: 21, apparent_temperature: 20,
        precipitation: 0, weather_code: 1, wind_speed_10m: 3, wind_gusts_10m: 5,
      },
    }), { status: 200 })));
    const service = new CurrentWeatherService(config, { sendMessage } as unknown as TelegramEffects);

    await expect(service.sendCurrentWeather()).resolves.toMatchObject({ observedAt: "2026-08-10T14:00" });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: -100n, messageThreadId: 42n, text: expect.stringContaining("Погода сейчас в Минске") }));
  });

  it("rejects a failed Open-Meteo response so the owner receives an API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const service = new CurrentWeatherService(config, { sendMessage: vi.fn() } as unknown as TelegramEffects);

    await expect(service.sendCurrentWeather()).rejects.toThrow("Open-Meteo returned 503");
  });
});
