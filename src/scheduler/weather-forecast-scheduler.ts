import type { Match } from "../db/schema.js";
import type { NotificationsRepository } from "../db/repositories/notifications.js";
import {
  formatWeatherForecastNotification,
  type WeatherForecastClient,
  weatherForecastTransitionKey,
} from "../application/weather-forecast.js";

export const WEATHER_FORECAST_LEAD_TIME_MS = 16 * 60 * 60 * 1000;
export const DEFAULT_WEATHER_FORECAST_CHECK_INTERVAL_MS = 60 * 1000;

export interface WeatherForecastNotificationStore {
  claim(input: {
    matchId: number;
    transitionKey: string;
  }): { id: number } | undefined;
  delete(id: number): boolean;
}

/** Adapts the persistent notification repository to the weather job's narrow API. */
export function createWeatherForecastNotificationStore(
  notifications: NotificationsRepository,
): WeatherForecastNotificationStore {
  return {
    claim: (input) => notifications.claimWeatherForecastDay(input),
    delete: (id) => notifications.delete(id),
  };
}

export interface WeatherForecastSchedulerRepositories {
  matches: {
    listScheduledBetween(start: Date, end: Date): Match[];
  };
  weatherNotifications: WeatherForecastNotificationStore;
}

export interface WeatherForecastNotifier {
  send(text: string): Promise<void>;
}

export interface WeatherForecastSchedulerOptions {
  chatId: number;
  repositories: WeatherForecastSchedulerRepositories;
  notifier: WeatherForecastNotifier;
  forecastClient: WeatherForecastClient;
  now?: () => Date;
  checkIntervalMs?: number;
  onError?: (error: unknown) => void;
}

export interface WeatherForecastRunResult {
  dueMatchIds: number[];
  sentMatchIds: number[];
  skippedBecauseRunning: boolean;
}

function defaultErrorReporter(error: unknown): void {
  const details = error instanceof Error ? error.message : String(error);
  console.error(`Weather forecast job failed: ${details}`);
}

function isDueForForecast(match: Match, now: Date): boolean {
  if (
    match.venueType !== "outdoor" ||
    match.scheduledAt === null ||
    match.scheduledAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  return now.getTime() >= match.scheduledAt.getTime() - WEATHER_FORECAST_LEAD_TIME_MS;
}

/**
 * Runs the Minsk weather job for active and confirmed outdoor matches.
 *
 * A notification is claimed before the forecast is fetched. If either the
 * forecast request or Telegram delivery fails, the claim is removed so a later
 * scheduler tick can retry. A process crash after the claim is intentionally
 * at-most-once, matching the bot's other notification paths.
 */
export class WeatherForecastScheduler {
  private readonly now: () => Date;
  private readonly checkIntervalMs: number;
  private readonly reportError: (error: unknown) => void;
  private timer: NodeJS.Timeout | undefined;
  private isRunning = false;

  public constructor(private readonly options: WeatherForecastSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_WEATHER_FORECAST_CHECK_INTERVAL_MS;
    this.reportError = options.onError ?? defaultErrorReporter;
    if (!Number.isSafeInteger(this.checkIntervalMs) || this.checkIntervalMs <= 0) {
      throw new Error("checkIntervalMs must be a positive safe integer");
    }
  }

  public start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.runSafely();
    }, this.checkIntervalMs);
    void this.runSafely();
  }

  public stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  public async runDueForecasts(): Promise<WeatherForecastRunResult> {
    if (this.isRunning) {
      return { dueMatchIds: [], sentMatchIds: [], skippedBecauseRunning: true };
    }
    this.isRunning = true;
    try {
      const now = this.now();
      const forecastWindowEnd = new Date(now.getTime() + WEATHER_FORECAST_LEAD_TIME_MS);
      const matches = this.options.repositories.matches
        .listScheduledBetween(now, forecastWindowEnd)
        .filter(
          (match) =>
            match.chatId === this.options.chatId &&
            (match.status === "active" || match.status === "confirmed") &&
            isDueForForecast(match, now),
        )
        .sort((left, right) => {
          const timeDifference = left.scheduledAt!.getTime() - right.scheduledAt!.getTime();
          return timeDifference === 0 ? left.id - right.id : timeDifference;
        });
      const sentMatchIds: number[] = [];

      for (const match of matches) {
        if (match.scheduledAt === null) continue;
        const claim = this.options.repositories.weatherNotifications.claim({
          matchId: match.id,
          transitionKey: weatherForecastTransitionKey(match.chatId, match.scheduledAt),
        });
        if (claim === undefined) continue;

        try {
          const forecast = await this.options.forecastClient.forecastAt(match.scheduledAt);
          await this.options.notifier.send(
            formatWeatherForecastNotification(forecast, match.scheduledAt, now),
          );
          sentMatchIds.push(match.id);
        } catch (error) {
          this.options.repositories.weatherNotifications.delete(claim.id);
          this.reportError(error);
        }
      }

      return {
        dueMatchIds: matches.map((match) => match.id),
        sentMatchIds,
        skippedBecauseRunning: false,
      };
    } finally {
      this.isRunning = false;
    }
  }

  private async runSafely(): Promise<void> {
    try {
      await this.runDueForecasts();
    } catch (error) {
      this.reportError(error);
    }
  }
}

export function createWeatherForecastScheduler(
  options: WeatherForecastSchedulerOptions,
): WeatherForecastScheduler {
  return new WeatherForecastScheduler(options);
}
