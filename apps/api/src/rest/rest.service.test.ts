import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  IdempotencyConflictError,
  OptimisticConcurrencyError,
  type AppDatabase,
} from "@football/db";

import { mapRestError } from "./rest.errors.js";
import { canonicalRequestHash } from "./rest.canonical.js";
import { MatchCreateDto } from "./rest.dto.js";
import { parseIfMatch, OwnerRestService } from "./rest.service.js";
import { serializeRestObject } from "./rest.serialization.js";
import type { ApiConfig } from "../config/api-config.js";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_OWNER_USER_ID: "9876543210",
    TELEGRAM_CHAT_ID: "-100",
    TELEGRAM_GENERAL_TOPIC_ID: "1",
    TELEGRAM_CHAT_TOPIC_ID: "2",
    TELEGRAM_MINI_APP_URL: "https://mini-app.test",
    WEB_ORIGIN: "https://mini-app.test",
    LOG_LEVEL: "info",
  });
});

const ownerId = 9_876_543_210n;

const config: ApiConfig = {
  databaseUrl: "postgresql://test:test@localhost:5432/test",
  telegramBotToken: "123456:test-token",
  telegramWebhookSecret: "test-secret",
  telegramOwnerUserId: ownerId,
  telegramGroupChatId: -100n,
  telegramGeneralTopicId: 1n,
  telegramChatTopicId: 2n,
  telegramMiniAppUrl: "https://mini-app.test",
  webOrigin: "https://mini-app.test",
  groupTimezone: "Europe/Minsk",
  logLevel: "info",
  port: 3000,
  miniAppInitDataMaxAgeSeconds: 86_400,
};

function validMatchInput(): MatchCreateDto {
  return {
    date: "2026-08-03",
    time: "20:00",
    location: "BOX365",
    venueType: "outdoor",
    requiredPlayers: 10,
    fieldPriceRubles: null,
  };
}

function responseOf(error: unknown): unknown {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

async function expectHttpError(
  promise: Promise<unknown>,
  response: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
    expect.fail("Expected an HTTP error");
  } catch (error) {
    expect(responseOf(error)).toEqual(response);
  }
}

describe("owner REST boundary", () => {
  it("serializes bigint identifiers without passing BigInt to JSON.stringify", () => {
    expect(serializeRestObject({
      id: 9_000_000_000_001n,
      nested: { chatId: -100_000_000_000_001n },
      values: [1n, new Date("2026-08-03T17:00:00.000Z")],
    })).toEqual({
      id: "9000000000001",
      nested: { chatId: "-100000000000001" },
      values: ["1", "2026-08-03T17:00:00.000Z"],
    });
  });

  it("creates the same canonical request hash for reordered object fields", () => {
    expect(canonicalRequestHash({ body: { b: 2, a: 1 }, id: 3n }))
      .toBe(canonicalRequestHash({ id: 3n, body: { a: 1, b: 2 } }));
  });

  it("requires mutation headers before touching a mocked database", async () => {
    const service = new OwnerRestService(null as unknown as AppDatabase, config);

    await expectHttpError(service.createMatch(ownerId, undefined, validMatchInput()), {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key is required for mutations.",
    });
  });

  it("fails closed for a non-owner even when the platform guard was bypassed in a unit test", async () => {
    const service = new OwnerRestService(null as unknown as AppDatabase, config);

    await expectHttpError(service.previewMatch(ownerId + 1n, "key-1", 1n), {
      code: "TELEGRAM_OWNER_REQUIRED",
      message: "This API is restricted to the configured owner.",
    });
  });

  it("maps stale versions and idempotency conflicts to stable responses", () => {
    expect(mapRestError(new OptimisticConcurrencyError(2, 3))).toEqual({
      status: 409,
      body: {
        code: "MATCH_VERSION_STALE",
        message: "The match was changed by another request; reload it before saving.",
        details: { expectedVersion: 2, actualVersion: 3 },
      },
    });
    expect(mapRestError(new IdempotencyConflictError("driver text must not escape"))).toEqual({
      status: 409,
      body: {
        code: "IDEMPOTENCY_KEY_CONFLICT",
        message: "The idempotency key was already used for a different request.",
      },
    });
  });

  it("parses required and weak quoted If-Match versions", () => {
    expect(parseIfMatch('W/"12"', true)).toBe(12);
    expect(parseIfMatch("13", true)).toBe(13);
    expect(() => parseIfMatch(undefined, true)).toThrow(HttpException);
    expect(() => parseIfMatch('"0"', true)).toThrow(HttpException);
  });
});
