import { describe, expect, it } from "vitest";

import {
  DEFAULT_GROUP_TIMEZONE,
  DEFAULT_MINI_APP_INIT_DATA_MAX_AGE_SECONDS,
  parseApiConfig,
  type ApiEnvironment,
} from "./config/api-config.js";

const secret = "123456:bot-token-that-must-not-be-logged";
const validEnvironment: ApiEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/football",
  TELEGRAM_BOT_TOKEN: secret,
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_OWNER_USER_ID: "123456789",
  TELEGRAM_CHAT_ID: "-1001234567890",
  TELEGRAM_GENERAL_TOPIC_ID: "1",
  TELEGRAM_CHAT_TOPIC_ID: "2",
  TELEGRAM_MINI_APP_URL: "https://example.test/mini-app",
  WEB_ORIGIN: "https://example.test",
  LOG_LEVEL: "info",
};

function without(name: string): ApiEnvironment {
  const environment = { ...validEnvironment };
  delete environment[name];
  return environment;
}

describe("API configuration", () => {
  it("loads only the new API settings and applies safe defaults", () => {
    const config = parseApiConfig(validEnvironment);

    expect(config.groupTimezone).toBe(DEFAULT_GROUP_TIMEZONE);
    expect(config.port).toBe(3000);
    expect(config.miniAppInitDataMaxAgeSeconds).toBe(DEFAULT_MINI_APP_INIT_DATA_MAX_AGE_SECONDS);
    expect("openrouter" in config).toBe(false);
    expect("confirmMatchCreation" in config).toBe(false);
    expect(config.telegramOwnerUserId).toBe(123456789n);
  });

  it("allows the Mini App init-data maximum age to be configured per environment", () => {
    expect(parseApiConfig({
      ...validEnvironment,
      TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS: "3600",
    }).miniAppInitDataMaxAgeSeconds).toBe(3_600);
  });

  it.each([
    "DATABASE_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_OWNER_USER_ID",
    "TELEGRAM_CHAT_ID",
    "TELEGRAM_GENERAL_TOPIC_ID",
    "TELEGRAM_CHAT_TOPIC_ID",
    "TELEGRAM_MINI_APP_URL",
    "WEB_ORIGIN",
    "LOG_LEVEL",
  ])("rejects a missing %s", (name) => {
    expect(() => parseApiConfig(without(name))).toThrow(name);
  });

  it.each([
    ["DATABASE_URL", "file:./football.db"],
    ["TELEGRAM_WEBHOOK_SECRET", "secret with spaces"],
    ["TELEGRAM_OWNER_USER_ID", "0"],
    ["TELEGRAM_CHAT_ID", "not-an-integer"],
    ["TELEGRAM_GENERAL_TOPIC_ID", "0"],
    ["TELEGRAM_CHAT_TOPIC_ID", "-1"],
    ["TELEGRAM_MINI_APP_URL", "javascript:alert(1)"],
    ["WEB_ORIGIN", "https://example.test/path"],
    ["GROUP_TIMEZONE", "Not/A_Timezone"],
    ["LOG_LEVEL", "trace"],
    ["PORT", "0"],
    ["TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS", "0"],
  ])("rejects invalid %s without exposing its value", (name, value) => {
    const environment = { ...validEnvironment, [name]: value };

    try {
      parseApiConfig(environment);
      expect.fail("configuration should have been rejected");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(value);
    }
  });
});
