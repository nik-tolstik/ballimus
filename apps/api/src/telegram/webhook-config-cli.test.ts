import { describe, expect, it, vi } from "vitest";

import { registerTelegramPollWebhook, validateTelegramWebhookUrl } from "./webhook-config-cli.js";

describe("Telegram poll webhook configuration", () => {
  it("accepts only the exact HTTPS webhook path", () => {
    expect(validateTelegramWebhookUrl("https://api.example.test/v1/telegram/webhook")).toBe("https://api.example.test/v1/telegram/webhook");
    expect(() => validateTelegramWebhookUrl("http://api.example.test/v1/telegram/webhook")).toThrow("HTTPS");
    expect(() => validateTelegramWebhookUrl("https://api.example.test/other")).toThrow("must end");
  });

  it("registers only poll updates with a secret token", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await registerTelegramPollWebhook("123456:test-token", "https://api.example.test/v1/telegram/webhook", fetchImplementation);
    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining("/setWebhook"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"allowed_updates":["poll"]'),
      }),
    );
  });
});
