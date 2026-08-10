import { describe, expect, it } from "vitest";

import { fetchTelegramWebhookStatus, parseTelegramWebhookStatus } from "./webhook-status-cli.js";

describe("Telegram webhook status CLI", () => {
  it("keeps the bot token out of the serialized status", () => {
    const status = parseTelegramWebhookStatus({
      ok: true,
      result: { url: "", pending_update_count: 0 },
    });

    expect(status).toEqual({ url: "", pendingUpdateCount: 0 });
    expect(JSON.stringify(status)).not.toContain("123456:secret-token");
  });

  it("rejects a malformed Bot API response", () => {
    expect(() => parseTelegramWebhookStatus({ ok: false })).toThrow("response was invalid");
  });

  it("does not expose a token when the Bot API request fails", async () => {
    await expect(fetchTelegramWebhookStatus("123456:secret-token", async () => {
      throw new Error("network failure");
    })).rejects.toThrow("Telegram webhook status request failed");
  });
});
