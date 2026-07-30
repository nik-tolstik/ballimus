import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  matches,
  notifications,
  type Notification,
  type NotificationDeliveryState,
  type NotificationType,
} from "../schema.js";
import {
  effectiveNow,
  jsonPayload,
  nonEmpty,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
} from "./common.js";
import {
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";

export interface ClaimNotificationInput {
  readonly matchId?: DatabaseIdentifier;
  readonly telegramChatId?: DatabaseIdentifier;
  readonly notificationType: NotificationType;
  readonly transitionKey: string;
  readonly weatherDay?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly claimedAt?: Date;
}

export interface ClaimWeatherNotificationInput {
  readonly telegramChatId: DatabaseIdentifier;
  readonly weatherDay: string;
  readonly transitionKey: string;
  readonly payload?: Record<string, unknown>;
  readonly claimedAt?: Date;
}

export type NotificationClaimResult =
  | { readonly status: "claimed"; readonly notification: Notification }
  | { readonly status: "duplicate"; readonly notification: Notification };

function notificationId(value: DatabaseIdentifier): bigint {
  return positiveBigInt(value, "notificationId");
}

function chatId(value: DatabaseIdentifier): bigint {
  const parsed = typeof value === "bigint" ? value : typeof value === "number" ? BigInt(value) : BigInt(value);
  if (parsed === 0n) throw new ValidationRepositoryError("telegramChatId must be non-zero");
  return parsed;
}

function validateType(value: NotificationType): void {
  if (![
    "threshold_reached",
    "threshold_lost",
    "withdrawal",
    "match_confirmed",
    "match_cancelled",
    "weather_forecast",
  ].includes(value)) throw new ValidationRepositoryError("Unsupported notification type");
}

function validateWeatherDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new ValidationRepositoryError("weatherDay must use YYYY-MM-DD");
  return value;
}

/** Durable, unique notification transition claims with retryable delivery states. */
export class NotificationsRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async find(
    matchId: DatabaseIdentifier,
    notificationType: NotificationType,
    transitionKey: string,
  ): Promise<Notification | undefined> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.matchId, positiveBigInt(matchId, "matchId")),
        eq(notifications.notificationType, notificationType),
        eq(notifications.transitionKey, nonEmpty(transitionKey, "transitionKey", 500)),
      ))
      .limit(1);
    return rows[0];
  }

  public async findById(id: DatabaseIdentifier): Promise<Notification | undefined> {
    const rows = await this.db.select().from(notifications).where(eq(notifications.id, notificationId(id))).limit(1);
    return rows[0];
  }

  public async has(input: ClaimNotificationInput): Promise<boolean> {
    if (input.notificationType === "weather_forecast") {
      if (input.telegramChatId === undefined || input.weatherDay === undefined || input.weatherDay === null) return false;
      const row = await this.findWeather(input.telegramChatId, input.weatherDay);
      return row !== undefined;
    }
    if (input.matchId === undefined) return false;
    return (await this.find(input.matchId, input.notificationType, input.transitionKey)) !== undefined;
  }

  public async claim(input: ClaimNotificationInput): Promise<NotificationClaimResult> {
    return this.db.transaction(async (tx) => new NotificationsRepository(tx).claimInTransaction(input));
  }

  public async claimInTransaction(input: ClaimNotificationInput): Promise<NotificationClaimResult> {
    validateType(input.notificationType);
    const transitionKey = nonEmpty(input.transitionKey, "transitionKey", 500);
    const now = effectiveNow(input.claimedAt);
    if (input.notificationType === "weather_forecast") {
      if (input.telegramChatId === undefined || input.weatherDay === undefined || input.weatherDay === null) {
        throw new ValidationRepositoryError("Weather notifications require telegramChatId and weatherDay");
      }
      return this.claimWeatherInTransaction({
        telegramChatId: input.telegramChatId,
        weatherDay: input.weatherDay,
        transitionKey,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
        claimedAt: now,
      });
    }
    if (input.matchId === undefined) throw new ValidationRepositoryError("Match notifications require matchId");
    const parsedMatchId = positiveBigInt(input.matchId, "matchId");
    const matchRows = await this.db.select({ telegramChatId: matches.telegramChatId }).from(matches).where(eq(matches.id, parsedMatchId)).limit(1);
    const match = matchRows[0];
    if (match === undefined) throw new NotFoundRepositoryError(`Match ${parsedMatchId} was not found`);
    const inserted = await this.db
      .insert(notifications)
      .values({
        matchId: parsedMatchId,
        telegramChatId: match.telegramChatId,
        notificationType: input.notificationType,
        transitionKey,
        weatherDay: null,
        deliveryState: "pending",
        payload: jsonPayload(input.payload),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const created = inserted[0];
    if (created !== undefined) return { status: "claimed", notification: created };
    const existing = await this.find(parsedMatchId, input.notificationType, transitionKey);
    if (existing === undefined) throw new RepositoryConflictError("Notification claim was lost concurrently");
    return { status: "duplicate", notification: existing };
  }

  public async claimWeatherForecastDay(input: ClaimWeatherNotificationInput): Promise<NotificationClaimResult> {
    return this.db.transaction(async (tx) => new NotificationsRepository(tx).claimWeatherInTransaction(input));
  }

  public async claimWeatherInTransaction(input: ClaimWeatherNotificationInput): Promise<NotificationClaimResult> {
    const telegramChatId = chatId(input.telegramChatId);
    const weatherDay = validateWeatherDay(input.weatherDay);
    const transitionKey = nonEmpty(input.transitionKey, "transitionKey", 500);
    const now = effectiveNow(input.claimedAt);
    const inserted = await this.db
      .insert(notifications)
      .values({
        matchId: null,
        telegramChatId,
        notificationType: "weather_forecast",
        transitionKey,
        weatherDay,
        deliveryState: "pending",
        payload: jsonPayload(input.payload),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const created = inserted[0];
    if (created !== undefined) return { status: "claimed", notification: created };
    const existing = await this.findWeather(telegramChatId, weatherDay);
    if (existing === undefined) throw new RepositoryConflictError("Weather notification claim was lost concurrently");
    if (existing.deliveryState !== "failed") {
      return { status: "duplicate", notification: existing };
    }

    const retried = await this.db
      .update(notifications)
      .set({
        transitionKey,
        deliveryState: "pending",
        sentAt: null,
        uncertainAt: null,
        lastError: null,
        ...(input.payload === undefined ? {} : { payload: jsonPayload(input.payload) }),
        updatedAt: now,
      })
      .where(and(
        eq(notifications.id, existing.id),
        eq(notifications.deliveryState, "failed"),
      ))
      .returning();
    const retry = retried[0];
    if (retry !== undefined) return { status: "claimed", notification: retry };

    const current = await this.findWeather(telegramChatId, weatherDay);
    if (current === undefined) throw new RepositoryConflictError("Weather notification retry was lost concurrently");
    return { status: "duplicate", notification: current };
  }

  public async findWeather(telegramChatId: DatabaseIdentifier, weatherDay: string): Promise<Notification | undefined> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.telegramChatId, chatId(telegramChatId)),
        eq(notifications.notificationType, "weather_forecast"),
        eq(notifications.weatherDay, validateWeatherDay(weatherDay)),
      ))
      .limit(1);
    return rows[0];
  }

  public async markSent(id: DatabaseIdentifier, sentAt?: Date, payload?: Record<string, unknown>): Promise<Notification> {
    const parsedId = notificationId(id);
    const now = effectiveNow(sentAt);
    const rows = await this.db
      .update(notifications)
      .set({ deliveryState: "sent", sentAt: now, uncertainAt: null, lastError: null, ...(payload === undefined ? {} : { payload: jsonPayload(payload) }), updatedAt: now })
      .where(eq(notifications.id, parsedId))
      .returning();
    const record = rows[0];
    if (record === undefined) throw new NotFoundRepositoryError(`Notification ${parsedId} was not found`);
    return record;
  }

  public async markUncertain(id: DatabaseIdentifier, error: string, uncertainAt?: Date): Promise<Notification> {
    return this.markDeliveryFailure(id, "uncertain", error, uncertainAt);
  }

  public async markFailed(id: DatabaseIdentifier, error: string, failedAt?: Date): Promise<Notification> {
    return this.markDeliveryFailure(id, "failed", error, failedAt);
  }

  public async resetForRetry(id: DatabaseIdentifier, retriedAt?: Date): Promise<Notification> {
    const parsedId = notificationId(id);
    const now = effectiveNow(retriedAt);
    const rows = await this.db
      .update(notifications)
      .set({ deliveryState: "pending", sentAt: null, uncertainAt: null, lastError: null, updatedAt: now })
      .where(and(eq(notifications.id, parsedId), isNotNull(notifications.lastError)))
      .returning();
    const record = rows[0];
    if (record === undefined) throw new RepositoryConflictError("Only failed or uncertain notifications can be retried");
    return record;
  }

  public async delete(id: DatabaseIdentifier): Promise<boolean> {
    const rows = await this.db.delete(notifications).where(eq(notifications.id, notificationId(id))).returning({ id: notifications.id });
    return rows.length > 0;
  }

  public async listByMatchId(matchId: DatabaseIdentifier): Promise<Notification[]> {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.matchId, positiveBigInt(matchId, "matchId")))
      .orderBy(desc(notifications.createdAt), desc(notifications.id));
  }

  public async listPending(limit = 100): Promise<Notification[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ValidationRepositoryError("limit must be positive");
    return this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.deliveryState, "pending"), isNotNull(notifications.id)))
      .orderBy(asc(notifications.createdAt), asc(notifications.id))
      .limit(limit);
  }

  private async markDeliveryFailure(
    id: DatabaseIdentifier,
    state: Extract<NotificationDeliveryState, "failed" | "uncertain">,
    error: string,
    occurredAt?: Date,
  ): Promise<Notification> {
    const parsedId = notificationId(id);
    const lastError = nonEmpty(error, "lastError", 2_000);
    const now = effectiveNow(occurredAt);
    const rows = await this.db
      .update(notifications)
      .set({ deliveryState: state, sentAt: null, uncertainAt: state === "uncertain" ? now : null, lastError, updatedAt: now })
      .where(eq(notifications.id, parsedId))
      .returning();
    const record = rows[0];
    if (record === undefined) throw new NotFoundRepositoryError(`Notification ${parsedId} was not found`);
    return record;
  }
}

export function createNotificationsRepository(db: AppDatabase): NotificationsRepository {
  return new NotificationsRepository(db);
}
