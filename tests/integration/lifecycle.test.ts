import type { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";

import { startBot } from "../../src/main.js";
import type { AppConfig } from "../../src/config.js";

const config: AppConfig = {
  telegram: {
    botToken: "test-token",
    chatId: -100123,
    chatTopicId: 42,
    generalTopicId: 1,
    statusUserId: 7,
  },
  openrouter: { model: "openai/gpt-4.1-mini" },
  databaseUrl: ":memory:",
  groupTimezone: "Europe/Minsk",
  defaultPlayersNeeded: 10,
  confirmMatchCreation: false,
  logLevel: "info",
};

describe("bot lifecycle", () => {
  it("drops pending updates and announces startup and shutdown in the private bot chat", async () => {
    let startOptions:
      | {
          drop_pending_updates?: boolean;
          onStart?: () => void | Promise<void>;
        }
      | undefined;
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const stop = vi.fn(async () => undefined);
    const bot = {
      api: { sendMessage },
      start: async (options: typeof startOptions) => {
        startOptions = options;
        await options?.onStart?.();
      },
      stop,
    } as unknown as Bot;

    await startBot(config, { createBot: () => bot });

    expect(startOptions?.drop_pending_updates).toBe(true);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      7,
      "🤖 Бот запущен и готов к работе.",
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      7,
      "🤖 Бот остановлен.",
    );
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not fail startup or shutdown when lifecycle notification fails", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error("Telegram unavailable");
    });
    const stop = vi.fn(async () => undefined);
    const bot = {
      api: { sendMessage },
      start: async (options: { onStart?: () => void | Promise<void> }) => {
        await options.onStart?.();
      },
      stop,
    } as unknown as Bot;

    await expect(startBot(config, { createBot: () => bot })).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledOnce();
  });
});
