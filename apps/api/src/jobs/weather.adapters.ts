import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  MatchesRepository,
  NotificationsRepository,
  type AppDatabase,
  type ClaimWeatherNotificationInput,
  type Notification,
  type NotificationClaimResult,
} from "@football/db";
import {
  getZonedDateParts,
  MINSK_LATITUDE,
  MINSK_LONGITUDE,
  parseOpenMeteoForecast,
  WEATHER_FORECAST_LEAD_TIME_MS,
} from "@football/domain";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { APP_DATABASE } from "../database/database.constants.js";
import {
  WEATHER_DUE_MATCH_PROVIDER,
  WEATHER_FORECAST_PROVIDER,
  WEATHER_NOTIFICATION_REPOSITORY,
  type WeatherDueMatch,
  type WeatherDueMatchProvider,
  type WeatherForecastProvider,
  type WeatherNotificationRepository,
} from "./weather.runner.js";

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast" as const;
export const WEATHER_PROVIDER_TIMEOUT_MS = 15_000;
export const OPEN_METEO_MAX_FORECAST_DAYS = 16;

function forecastDaysFor(scheduledAt: Date, now: Date, timezone: string): number {
  const current = getZonedDateParts(now, timezone);
  const scheduled = getZonedDateParts(scheduledAt, timezone);
  const currentDay = Date.UTC(current.year, current.month - 1, current.day);
  const scheduledDay = Date.UTC(scheduled.year, scheduled.month - 1, scheduled.day);
  const daysAhead = Math.round((scheduledDay - currentDay) / (24 * 60 * 60 * 1000));
  return Math.min(OPEN_METEO_MAX_FORECAST_DAYS, Math.max(2, daysAhead + 1));
}

/** Reads only the short future window in which the weather job can be eligible. */
@Injectable()
export class DatabaseWeatherDueMatchProvider implements WeatherDueMatchProvider {
  private readonly matches: MatchesRepository;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() matches?: MatchesRepository,
  ) {
    this.matches = matches ?? new MatchesRepository(db);
  }

  public async listDueMatches(now: Date): Promise<readonly WeatherDueMatch[]> {
    const matches = await this.matches.listScheduledBetween({
      start: now,
      end: new Date(now.getTime() + WEATHER_FORECAST_LEAD_TIME_MS),
      telegramChatId: this.config.telegramGroupChatId,
    });

    return matches.map((match) => ({
      id: match.id,
      chatId: match.telegramChatId,
      status: match.status,
      venueType: match.venueType,
      scheduledAt: match.scheduledAt,
    }));
  }
}

/** Adapts durable PostgreSQL weather notification claims to the runner port. */
@Injectable()
export class DatabaseWeatherNotificationRepository implements WeatherNotificationRepository {
  private readonly notifications: NotificationsRepository;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Optional() notifications?: NotificationsRepository,
  ) {
    this.notifications = notifications ?? new NotificationsRepository(db);
  }

  public claimWeatherForecastDay(
    input: ClaimWeatherNotificationInput,
  ): Promise<NotificationClaimResult> {
    return this.notifications.claimWeatherForecastDay(input);
  }

  public markSent(
    id: bigint,
    sentAt?: Date,
    payload?: Record<string, unknown>,
  ): Promise<Notification> {
    return this.notifications.markSent(id, sentAt, payload);
  }

  public markFailed(id: bigint, error: string, failedAt?: Date): Promise<Notification> {
    return this.notifications.markFailed(id, error, failedAt);
  }

  public markUncertain(id: bigint, error: string, uncertainAt?: Date): Promise<Notification> {
    return this.notifications.markUncertain(id, error, uncertainAt);
  }
}

/** Bounded Open-Meteo adapter; the job performs one request and never polls. */
@Injectable()
export class OpenMeteoWeatherForecastProvider implements WeatherForecastProvider {
  private readonly fetchImpl: typeof globalThis.fetch;

  public constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() fetchImpl?: typeof globalThis.fetch,
  ) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  public async getForecast(match: WeatherDueMatch, now: Date) {
    void now;
    if (match.scheduledAt === null) {
      throw new Error("Weather forecast requires a scheduled match time");
    }

    const url = new URL(OPEN_METEO_FORECAST_URL);
    url.searchParams.set("latitude", String(MINSK_LATITUDE));
    url.searchParams.set("longitude", String(MINSK_LONGITUDE));
    url.searchParams.set(
      "hourly",
      [
        "temperature_2m",
        "apparent_temperature",
        "precipitation_probability",
        "precipitation",
        "weather_code",
        "wind_speed_10m",
        "wind_gusts_10m",
      ].join(","),
    );
    url.searchParams.set(
      "forecast_days",
      String(forecastDaysFor(match.scheduledAt, now, this.config.groupTimezone)),
    );
    url.searchParams.set("timezone", this.config.groupTimezone);
    url.searchParams.set("temperature_unit", "celsius");
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("precipitation_unit", "mm");

    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(WEATHER_PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed with HTTP ${response.status}`);
    }

    return parseOpenMeteoForecast(
      await response.json(),
      match.scheduledAt,
      this.config.groupTimezone,
    );
  }
}

export const WEATHER_JOB_PROVIDERS = [
  {
    provide: WEATHER_DUE_MATCH_PROVIDER,
    useExisting: DatabaseWeatherDueMatchProvider,
  },
  {
    provide: WEATHER_FORECAST_PROVIDER,
    useExisting: OpenMeteoWeatherForecastProvider,
  },
  {
    provide: WEATHER_NOTIFICATION_REPOSITORY,
    useExisting: DatabaseWeatherNotificationRepository,
  },
] as const;
