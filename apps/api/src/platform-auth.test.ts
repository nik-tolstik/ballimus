import { createHmac } from "node:crypto";

import { Reflector } from "@nestjs/core";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { parseApiConfig, type ApiConfig } from "./config/api-config.js";
import {
  MINI_APP_REQUEST_USER,
  TELEGRAM_WEB_APP_DATA_LABEL,
} from "./auth/mini-app-auth.constants.js";
import { MiniAppAuthBypass } from "./auth/mini-app-auth.decorator.js";
import {
  MiniAppAuthGuard,
  MiniAppAuthValidationError,
  validateTelegramMiniAppInitData,
} from "./auth/mini-app-auth.guard.js";

const botToken = "123456:bot-token-for-fixtures";
const ownerUserId = 123456789n;
const nowSeconds = 1_750_000_000;

const config: ApiConfig = parseApiConfig({
  DATABASE_URL: "postgresql://user:password@localhost:5432/football",
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_OWNER_USER_ID: ownerUserId.toString(),
  TELEGRAM_CHAT_ID: "-1001234567890",
  TELEGRAM_GENERAL_TOPIC_ID: "1",
  TELEGRAM_CHAT_TOPIC_ID: "2",
  TELEGRAM_MINI_APP_URL: "https://example.test/mini-app",
  WEB_ORIGIN: "https://example.test",
  LOG_LEVEL: "info",
});

function createSignedInitData(userId: bigint, authDate = Math.floor(Date.now() / 1000)): string {
  const parameters = new URLSearchParams();
  parameters.set("auth_date", String(authDate));
  parameters.set("query_id", "AAEAAQ");
  parameters.set("user", JSON.stringify({ first_name: "Owner", id: Number(userId) }));

  const dataCheckString = Array.from(parameters.entries())
    .sort(([leftName], [rightName]) => (leftName < rightName ? -1 : leftName > rightName ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", TELEGRAM_WEB_APP_DATA_LABEL).update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  parameters.set("hash", hash);
  return parameters.toString();
}

function requestContext(rawInitData: string | undefined): {
  readonly context: ExecutionContext;
  readonly request: { headers: Record<string, unknown>; [key: string]: unknown };
} {
  const request = { headers: {} as Record<string, unknown> };
  if (rawInitData !== undefined) request.headers["x-telegram-init-data"] = rawInitData;
  const handler = function routeHandler(): void {};
  const routeClass = class RouteClass {};
  const context = {
    getClass: () => routeClass,
    getHandler: () => handler,
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("Telegram Mini App authentication", () => {
  it("accepts valid owner init data and attaches only the validated user id", () => {
    const { context, request } = requestContext(createSignedInitData(ownerUserId));
    const guard = new MiniAppAuthGuard(new Reflector(), config);

    expect(guard.canActivate(context)).toBe(true);
    expect((request["telegramMiniAppUser"] as { id: bigint } | undefined)?.id).toBe(ownerUserId);
    expect(request["rawInitData"]).toBeUndefined();
    expect(request["initDataUnsafe"]).toBeUndefined();
  });

  it("rejects missing and malformed init data with clear 401 codes", () => {
    const guard = new MiniAppAuthGuard(new Reflector(), config);

    for (const rawInitData of [undefined, "not-a-query-string"]) {
      const { context } = requestContext(rawInitData);
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    }

    const { context } = requestContext("not-a-query-string");
    try {
      guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: "TELEGRAM_INIT_DATA_MALFORMED",
      });
    }
  });

  it("rejects expired sessions with a reopen-the-Mini-App error", () => {
    const rawInitData = createSignedInitData(ownerUserId, nowSeconds - config.miniAppInitDataMaxAgeSeconds - 1);

    expect(() =>
      validateTelegramMiniAppInitData(rawInitData, {
        botToken,
        ownerUserId,
        maxAgeSeconds: config.miniAppInitDataMaxAgeSeconds,
        nowSeconds,
      }),
    ).toThrowError(MiniAppAuthValidationError);

    try {
      validateTelegramMiniAppInitData(rawInitData, {
        botToken,
        ownerUserId,
        maxAgeSeconds: config.miniAppInitDataMaxAgeSeconds,
        nowSeconds,
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "TELEGRAM_INIT_DATA_EXPIRED",
        message: "Telegram Mini App init data has expired; reopen the Mini App.",
      });
    }
  });

  it("rejects a valid Telegram user who is not the configured owner", () => {
    const guard = new MiniAppAuthGuard(new Reflector(), config);
    const { context } = requestContext(createSignedInitData(987654321n));

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "TELEGRAM_OWNER_REQUIRED",
      });
    }
  });

  it("allows only explicitly named platform bypass routes", () => {
    class HealthRoute {
      @MiniAppAuthBypass("health")
      get(): void {}
    }
    const guard = new MiniAppAuthGuard(new Reflector(), config);
    const request = requestContext(undefined);
    const context = {
      getClass: () => HealthRoute,
      getHandler: () => HealthRoute.prototype.get,
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => request.request }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(request.request[MINI_APP_REQUEST_USER]).toBeUndefined();
  });
});
