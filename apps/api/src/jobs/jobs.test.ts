import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiConfig } from "../config/api-config.js";
import type { Notification, NotificationClaimResult, OutboxEvent } from "@football/db";
import { describe, expect, it, vi } from "vitest";

import {
  JobsRunner,
  JOBS_RUN_JOB_NAME,
  type JobClaimsPort,
  type OutboxClaimPort,
} from "./jobs.runner.js";
import {
  OutboxDispatcher,
  type OutboxDeliveryRepository,
} from "./outbox.dispatcher.js";
import {
  WeatherRunner,
  type WeatherDueMatch,
  type WeatherDueMatchProvider,
  type WeatherForecastProvider,
  type WeatherNotificationRepository,
} from "./weather.runner.js";

function config(): ApiConfig {
  return {
    databaseUrl: "postgres://localhost/football",
    telegramBotToken: "test-token",
    telegramWebhookSecret: "test-secret",
    telegramOwnerUserId: 1n,
    telegramGroupChatId: -100n,
    telegramGeneralTopicId: 1n,
    telegramChatTopicId: 42n,
    telegramMiniAppUrl: "https://example.test/mini-app",
    webOrigin: "https://example.test",
    groupTimezone: "Europe/Minsk",
    logLevel: "info",
    port: 3000,
    miniAppInitDataMaxAgeSeconds: 86_400,
  };
}

function outboxEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 1n,
    eventType: "refresh_public_card",
    deduplicationKey: "test:event",
    matchId: 10n,
    notificationId: null,
    telegramChatId: -100n,
    telegramTopicId: 1n,
    payload: {},
    deliveryState: "processing",
    attemptCount: 1,
    availableAt: new Date("2026-07-29T00:00:00.000Z"),
    lockedAt: new Date("2026-07-29T00:00:00.000Z"),
    leaseExpiresAt: new Date("2026-07-29T00:01:00.000Z"),
    deliveredAt: null,
    uncertainAt: null,
    lastError: null,
    createdAt: new Date("2026-07-29T00:00:00.000Z"),
    updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    ...overrides,
  };
}

function notification(id: bigint, state: Notification["deliveryState"] = "pending"): Notification {
  return {
    id,
    matchId: null,
    telegramChatId: -100n,
    notificationType: "weather_forecast",
    transitionKey: "forecast:-100:2026-07-29",
    weatherDay: "2026-07-29",
    deliveryState: state,
    payload: {},
    sentAt: null,
    uncertainAt: null,
    lastError: null,
    createdAt: new Date("2026-07-29T00:00:00.000Z"),
    updatedAt: new Date("2026-07-29T00:00:00.000Z"),
  };
}

function weatherMatch(
  id: bigint,
  changes: Partial<WeatherDueMatch> = {},
): WeatherDueMatch {
  return {
    id,
    chatId: -100n,
    status: "active",
    venueType: "outdoor",
    scheduledAt: new Date("2026-07-29T20:00:00.000Z"),
    ...changes,
  };
}

describe("jobs", () => {
  it("returns busy without claiming or dispatching when the jobs lease is held", async () => {
    const run = vi.fn<JobClaimsPort["run"]>().mockResolvedValue({
      status: "busy",
      claim: { jobName: JOBS_RUN_JOB_NAME, claimToken: "other", claimedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), lastCompletedAt: null, lastError: null, updatedAt: new Date() },
    });
    const claim = vi.fn<OutboxClaimPort["claim"]>();
    const dispatch = vi.fn();
    const runner = new JobsRunner(
      {} as never,
      { dispatch } as never,
      { runOnce: vi.fn() } as never,
      { run } as JobClaimsPort,
      { claim } as OutboxClaimPort,
    );

    const result = await runner.runOnce();

    expect(result.status).toBe("busy");
    expect(run).toHaveBeenCalledWith(JOBS_RUN_JOB_NAME, expect.any(Function), expect.objectContaining({ leaseDurationMs: 60_000 }));
    expect(claim).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("claims only one bounded outbox batch before completing the lease", async () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    const event = outboxEvent();
    const claim = vi.fn<OutboxClaimPort["claim"]>().mockResolvedValue([event]);
    const run = vi.fn<JobClaimsPort["run"]>().mockImplementation(async (_job, work) => ({
      status: "completed",
      value: await work({
        jobName: JOBS_RUN_JOB_NAME,
        claimToken: "owned",
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        lastCompletedAt: null,
        lastError: null,
        updatedAt: now,
      }),
    }));
    const dispatch = vi.fn().mockResolvedValue({
      status: "delivered",
      eventId: event.id,
      event,
    });
    const runner = new JobsRunner(
      {} as never,
      { dispatch } as never,
      { runOnce: vi.fn() } as never,
      { run } as JobClaimsPort,
      { claim } as OutboxClaimPort,
    );

    const result = await runner.runOnce({ now, outboxBatchSize: 3 });

    expect(result.status).toBe("completed");
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ limit: 3, leaseDurationMs: 60_000, now }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("runs weather inside the same lease and returns the combined summary", async () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    const event = outboxEvent();
    const order: string[] = [];
    const claim = vi.fn<OutboxClaimPort["claim"]>().mockResolvedValue([event]);
    const dispatch = vi.fn(async () => {
      order.push("outbox");
      return { status: "delivered" as const, eventId: event.id, event };
    });
    const weather = {
      runOnce: vi.fn(async (runAt: Date) => {
        order.push("weather");
        expect(runAt).toBe(now);
        return { candidates: 1, claimed: 1, duplicates: 0, sent: 1, failed: 0, skipped: 0 };
      }),
    };
    const run = vi.fn<JobClaimsPort["run"]>().mockImplementation(async (_job, work) => {
      order.push("lease-enter");
      const value = await work({
        jobName: JOBS_RUN_JOB_NAME,
        claimToken: "owned",
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        lastCompletedAt: null,
        lastError: null,
        updatedAt: now,
      });
      order.push("lease-exit");
      return { status: "completed", value };
    });

    const runner = new JobsRunner(
      {} as never,
      { dispatch } as never,
      weather as never,
      { run } as JobClaimsPort,
      { claim } as OutboxClaimPort,
    );

    const result = await runner.runOnce({ now });

    expect(result.status).toBe("completed");
    expect(result.status === "completed" ? result.summary.weather : undefined).toEqual({
      candidates: 1,
      claimed: 1,
      duplicates: 0,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    expect(order).toEqual(["lease-enter", "outbox", "weather", "lease-exit"]);
  });

  it("uses a bounded outbox claim and records retryable and uncertain outcomes", async () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    const refresh = outboxEvent({ attemptCount: 2 });
    const publish = outboxEvent({ id: 2n, eventType: "publish_public_card", deduplicationKey: "publish:test" });
    const delivery: OutboxDeliveryRepository = {
      markDelivered: vi.fn(async (id) => outboxEvent({ id, deliveryState: "delivered" })),
      markFailed: vi.fn(async (id) => outboxEvent({ id, deliveryState: "failed", lastError: "Telegram unavailable" })),
      markUncertain: vi.fn(async (id) => outboxEvent({ id, deliveryState: "uncertain", uncertainAt: now, lastError: "reconcile" })),
    };
    const cards = {
      refreshPublicCard: vi.fn().mockRejectedValue(new Error("Telegram unavailable")),
      publishInitialCard: vi.fn().mockResolvedValue({ status: "reconciliation_required", publicationState: "uncertain" }),
    };
    const dispatcher = new OutboxDispatcher(
      {} as never,
      {} as never,
      cards as never,
      delivery,
      { findByMatchId: vi.fn(), markDeleted: vi.fn() },
      { findById: vi.fn(), markSent: vi.fn() },
    );

    const failed = await dispatcher.dispatch(refresh, { now });
    const uncertain = await dispatcher.dispatch(publish, { now });

    expect(failed.status).toBe("failed");
    expect(failed.status === "failed" ? failed.availableAt.getTime() : 0).toBe(now.getTime() + 120_000);
    expect(delivery.markFailed).toHaveBeenCalledWith(refresh.id, "Telegram unavailable", expect.objectContaining({ availableAt: expect.any(Date) }));
    expect(uncertain.status).toBe("uncertain");
    expect(delivery.markUncertain).toHaveBeenCalledWith(publish.id, expect.stringContaining("reconciliation"), now);
    expect(delivery.markDelivered).not.toHaveBeenCalled();
  });

  it("filters indoor and untimed matches and deduplicates one Minsk day per chat", async () => {
    const now = new Date("2026-07-29T05:00:00.000Z");
    const eligible = weatherMatch(1n);
    const duplicateDay = weatherMatch(2n, { status: "confirmed" });
    const due: readonly WeatherDueMatch[] = [
      weatherMatch(3n, { venueType: "indoor" }),
      weatherMatch(4n, { scheduledAt: null }),
      eligible,
      duplicateDay,
      weatherMatch(5n, { status: "completed" }),
    ];
    const dueProvider: WeatherDueMatchProvider = {
      listDueMatches: vi.fn().mockResolvedValue(due),
    };
    const forecasts: WeatherForecastProvider = {
      getForecast: vi.fn().mockResolvedValue({
        forecastTime: "2026-07-29T23:00",
        temperatureCelsius: 20,
        apparentTemperatureCelsius: 20,
        precipitationProbability: 10,
        precipitationMillimetres: 0,
        weatherCode: 1,
        windSpeedMetresPerSecond: 2,
        windGustsMetresPerSecond: 3,
      }),
    };
    const claims = new Map<string, Notification>();
    const notifications: WeatherNotificationRepository = {
      claimWeatherForecastDay: vi.fn(async (input): Promise<NotificationClaimResult> => {
        const key = `${String(input.telegramChatId)}:${input.weatherDay}`;
        const existing = claims.get(key);
        if (existing !== undefined) return { status: "duplicate", notification: existing };
        const created = notification(BigInt(claims.size + 1));
        claims.set(key, created);
        return { status: "claimed", notification: created };
      }),
      markSent: vi.fn(async (id) => notification(id, "sent")),
      markFailed: vi.fn(async (id) => notification(id, "failed")),
      markUncertain: vi.fn(async (id) => notification(id, "uncertain")),
    };
    const effects = { sendMessage: vi.fn().mockResolvedValue({ messageId: 1n }) };
    const runner = new WeatherRunner(config(), dueProvider, forecasts, notifications, effects as never);

    const first = await runner.runOnce(now);
    const second = await runner.runOnce(now);

    expect(first.candidates).toBe(2);
    expect(first.sent).toBe(1);
    expect(first.duplicates).toBe(1);
    expect(first.failed).toBe(0);
    expect(second.sent).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(notifications.claimWeatherForecastDay).toHaveBeenCalledTimes(2);
    expect(forecasts.getForecast).toHaveBeenCalledTimes(1);
    expect(effects.sendMessage).toHaveBeenCalledTimes(1);
    expect(effects.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: -100n, messageThreadId: 42n }));
  });

  it("does not contain permanent timer or polling APIs in the implementation files", () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const implementationFiles = ["jobs.module.ts", "jobs.runner.ts", "outbox.dispatcher.ts", "weather.runner.ts"];
    const source = implementationFiles.map((file) => readFileSync(join(directory, file), "utf8")).join("\n");
    const forbidden = [
      ["set", "Interval"].join(""),
      ["set", "Timeout"].join(""),
      ["node", "-cron"].join(""),
      ["bot", ".start"].join(""),
      ["long", " polling"].join(""),
    ];
    for (const fragment of forbidden) expect(source).not.toContain(fragment);
  });
});
