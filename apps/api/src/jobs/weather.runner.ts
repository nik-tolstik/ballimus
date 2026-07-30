import { Inject, Injectable } from "@nestjs/common";
import type {
  ClaimWeatherNotificationInput,
  Notification,
  NotificationClaimResult,
} from "@football/db";
import {
  calendarDateInTimeZone,
  formatWeatherForecastNotification,
  isWeatherForecastEligible,
  MINSK_TIMEZONE,
  weatherForecastTransitionKey,
  type Match,
  type WeatherForecast,
} from "@football/domain";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { TelegramEffects } from "../telegram/telegram-effects.js";

export const WEATHER_DUE_MATCH_PROVIDER = Symbol("WEATHER_DUE_MATCH_PROVIDER");
export const WEATHER_FORECAST_PROVIDER = Symbol("WEATHER_FORECAST_PROVIDER");
export const WEATHER_NOTIFICATION_REPOSITORY = Symbol("WEATHER_NOTIFICATION_REPOSITORY");

export type WeatherDueMatch = Pick<
  Match,
  "id" | "chatId" | "status" | "venueType" | "scheduledAt"
>;

export interface WeatherDueMatchProvider {
  listDueMatches(now: Date): Promise<readonly WeatherDueMatch[]>;
}

export interface WeatherForecastProvider {
  getForecast(match: WeatherDueMatch, now: Date): Promise<WeatherForecast>;
}

export interface WeatherNotificationRepository {
  claimWeatherForecastDay(
    input: ClaimWeatherNotificationInput,
  ): Promise<NotificationClaimResult>;
  markSent(id: bigint, sentAt?: Date, payload?: Record<string, unknown>): Promise<Notification>;
  markFailed(id: bigint, error: string, failedAt?: Date): Promise<Notification>;
}

export interface WeatherRunSummary {
  readonly candidates: number;
  readonly claimed: number;
  readonly duplicates: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === "" ? "Weather notification failed" : text;
}

function sameChat(left: WeatherDueMatch["chatId"], right: bigint): boolean {
  return String(left) === right.toString(10);
}

function topicInput(topicId: bigint): { readonly messageThreadId?: bigint } {
  return topicId === 1n ? {} : { messageThreadId: topicId };
}

/** Sends at most one weather forecast per configured chat and Minsk match day. */
@Injectable()
export class WeatherRunner {
  public constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(WEATHER_DUE_MATCH_PROVIDER)
    private readonly dueMatches: WeatherDueMatchProvider,
    @Inject(WEATHER_FORECAST_PROVIDER)
    private readonly forecasts: WeatherForecastProvider,
    @Inject(WEATHER_NOTIFICATION_REPOSITORY)
    private readonly notifications: WeatherNotificationRepository,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
  ) {}

  public async runOnce(now: Date = new Date()): Promise<WeatherRunSummary> {
    const referenceTime = new Date(now.getTime());
    const dueMatches = await this.dueMatches.listDueMatches(referenceTime);
    const seenDays = new Set<string>();
    let candidates = 0;
    let claimed = 0;
    let duplicates = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const match of dueMatches) {
      if (!sameChat(match.chatId, this.config.telegramGroupChatId)) {
        skipped += 1;
        continue;
      }
      if (!isWeatherForecastEligible({ match, now: referenceTime })) {
        skipped += 1;
        continue;
      }
      candidates += 1;
      if (match.scheduledAt === null) {
        skipped += 1;
        continue;
      }

      const weatherDay = calendarDateInTimeZone(match.scheduledAt, MINSK_TIMEZONE);
      const dayKey = `${String(match.chatId)}:${weatherDay}`;
      if (seenDays.has(dayKey)) {
        duplicates += 1;
        continue;
      }
      seenDays.add(dayKey);

      const claim = await this.notifications.claimWeatherForecastDay({
        telegramChatId: match.chatId,
        weatherDay,
        transitionKey: weatherForecastTransitionKey(match.chatId, match.scheduledAt, MINSK_TIMEZONE),
        claimedAt: referenceTime,
      });
      if (claim.status === "duplicate") {
        duplicates += 1;
        continue;
      }
      claimed += 1;

      try {
        const forecast = await this.forecasts.getForecast(match, referenceTime);
        const text = formatWeatherForecastNotification(
          forecast,
          match.scheduledAt,
          referenceTime,
          MINSK_TIMEZONE,
        );
        await this.effects.sendMessage({
          chatId: match.chatId,
          text,
          ...topicInput(this.config.telegramChatTopicId),
        });
        await this.notifications.markSent(claim.notification.id, referenceTime, {
          ...claim.notification.payload,
          text,
          matchId: String(match.id),
          weatherDay,
        });
        sent += 1;
      } catch (error) {
        await this.notifications.markFailed(
          claim.notification.id,
          errorText(error),
          referenceTime,
        );
        failed += 1;
      }
    }

    return { candidates, claimed, duplicates, sent, failed, skipped };
  }
}
