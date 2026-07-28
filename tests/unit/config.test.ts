import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig, validateStartupConfig } from "../../src/config.js";

describe("configuration", () => {
  it("loads safe defaults without requiring a Telegram token", () => {
    const config = loadConfig({});

    expect(config.groupTimezone).toBe("Europe/Minsk");
    expect(config.defaultPlayersNeeded).toBe(10);
    expect(config.openrouter.model).toBe("openai/gpt-4.1-mini");
    expect(config.telegram.botToken).toBeUndefined();
  });

  it("requires the bot token only at the startup boundary", () => {
    expect(() => validateStartupConfig(loadConfig({}))).toThrowError(ConfigurationError);
    expect(() => validateStartupConfig(loadConfig({}))).toThrow("TELEGRAM_BOT_TOKEN");

    const startup = validateStartupConfig(loadConfig({ TELEGRAM_BOT_TOKEN: "test-token" }));
    expect(startup.telegram.botToken).toBe("test-token");
  });

  it("parses topic and numeric settings without logging or coercing invalid values", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "-100123",
      TELEGRAM_CHAT_TOPIC_ID: "42",
      TELEGRAM_GENERAL_TOPIC_ID: "1",
      TELEGRAM_STATUS_USER_ID: "7",
      DEFAULT_PLAYERS_NEEDED: "7",
      CONFIRM_MATCH_CREATION: "true",
    });

    expect(config.telegram).toMatchObject({
      chatId: -100123,
      chatTopicId: 42,
      generalTopicId: 1,
      statusUserId: 7,
    });
    expect(config.defaultPlayersNeeded).toBe(7);
    expect(config.confirmMatchCreation).toBe(true);
    expect(() => loadConfig({ DEFAULT_PLAYERS_NEEDED: "not-a-number" })).toThrow(ConfigurationError);
  });
});
