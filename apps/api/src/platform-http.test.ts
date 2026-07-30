import { afterAll, beforeAll, describe, expect, it } from "vitest";

const API_CORS_ALLOWED_HEADERS = [
  "X-Telegram-Init-Data",
  "Idempotency-Key",
  "If-Match",
  "Content-Type",
] as const;

const environment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/football",
  TELEGRAM_BOT_TOKEN: "123456:http-test-token",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_OWNER_USER_ID: "123456789",
  TELEGRAM_CHAT_ID: "-1001234567890",
  TELEGRAM_GENERAL_TOPIC_ID: "1",
  TELEGRAM_CHAT_TOPIC_ID: "2",
  TELEGRAM_MINI_APP_URL: "https://example.test/mini-app",
  WEB_ORIGIN: "https://example.test",
  LOG_LEVEL: "info",
};

const originalEnvironment = new Map<string, string | undefined>();
let baseUrl = "";
let closeApplication: (() => Promise<void>) | undefined;

describe("API HTTP platform", () => {
  beforeAll(async () => {
    for (const [name, value] of Object.entries(environment)) {
      originalEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }

    const { createApiApplication: createApplication } = await import("./bootstrap.js");
    const app = await createApplication();
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    closeApplication = () => app.close();
  });

  afterAll(async () => {
    await closeApplication?.();
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("serves GET /health without Mini App init data", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: environment.WEB_ORIGIN },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", service: "api" });
    expect(response.headers.get("access-control-allow-origin")).toBe(environment.WEB_ORIGIN);
  });

  it("allows only the exact configured origin and required request headers", async () => {
    const response = await fetch(`${baseUrl}/v1/not-implemented`, {
      headers: {
        Origin: environment.WEB_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": API_CORS_ALLOWED_HEADERS.join(","),
      },
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(environment.WEB_ORIGIN);
    expect(response.headers.get("access-control-allow-headers")).toContain("X-Telegram-Init-Data");
    expect(response.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
    expect(response.headers.get("access-control-allow-headers")).toContain("If-Match");
    expect(response.headers.get("access-control-allow-headers")).toContain("Content-Type");
    expect(response.headers.get("access-control-allow-headers")).not.toContain("*");

    const otherOrigin = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://not-the-configured-origin.test" },
    });
    expect(otherOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });
});
