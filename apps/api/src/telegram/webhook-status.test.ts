import { describe, expect, it } from "vitest";

import { inspectTelegramWebhook } from "./webhook-status.js";

const expectedUrl = "https://api.example.test/telegram/webhook";
const botToken = "123456:bot-token-that-must-not-be-logged";

function telegramResponse(result: Record<string, unknown>, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify({ ok: true, result }), { status });
}

describe("Telegram webhook status", () => {
  it("returns a redacted healthy status for the configured production webhook", async () => {
    const status = await inspectTelegramWebhook({
      botToken,
      expectedUrl,
      fetchImplementation: telegramResponse({
        url: expectedUrl,
        allowed_updates: ["callback_query"],
        pending_update_count: 0,
      }),
    });

    expect(status).toEqual({
      telegramApiAccepted: true,
      webhookMatchesExpectedUrl: true,
      callbackQueryAllowed: true,
      onlyCallbackQueriesAllowed: true,
      pendingUpdateCount: 0,
      hasLastError: false,
    });
    expect(JSON.stringify(status)).not.toContain(botToken);
  });

  it("detects a misconfigured webhook and a Telegram delivery error", async () => {
    const status = await inspectTelegramWebhook({
      botToken,
      expectedUrl,
      fetchImplementation: telegramResponse({
        url: "https://old.example.test/telegram/webhook",
        allowed_updates: ["message"],
        pending_update_count: 3,
        last_error_message: "Wrong response from the webhook",
      }),
    });

    expect(status).toMatchObject({
      webhookMatchesExpectedUrl: false,
      callbackQueryAllowed: false,
      onlyCallbackQueriesAllowed: false,
      pendingUpdateCount: 3,
      hasLastError: true,
    });
  });

  it("rejects an invalid response without exposing the bot token", async () => {
    await expect(inspectTelegramWebhook({
      botToken,
      expectedUrl,
      fetchImplementation: async () => new Response(JSON.stringify({ ok: false }), { status: 200 }),
    })).rejects.toThrow("invalid");
  });
});
