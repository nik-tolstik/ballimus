import { and, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  notifications,
  type Notification,
  type NotificationType,
} from "../schema.js";

export interface CreateNotificationInput {
  matchId: number;
  notificationType: NotificationType;
  transitionKey: string;
  sentAt?: Date;
}

export class NotificationsRepository {
  public constructor(private readonly db: AppDatabase) {}

  public find(
    matchId: number,
    notificationType: NotificationType,
    transitionKey: string,
  ): Notification | undefined {
    return this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.matchId, matchId),
          eq(notifications.notificationType, notificationType),
          eq(notifications.transitionKey, transitionKey),
        ),
      )
      .get();
  }

  public has(input: CreateNotificationInput): boolean {
    return this.find(input.matchId, input.notificationType, input.transitionKey) !== undefined;
  }

  public create(input: CreateNotificationInput): Notification {
    const record = this.db
      .insert(notifications)
      .values({
        matchId: input.matchId,
        notificationType: input.notificationType,
        transitionKey: input.transitionKey,
        sentAt: input.sentAt ?? new Date(),
      })
      .returning()
      .get();

    if (!record) {
      throw new Error("Notification was not recorded");
    }

    return record;
  }

  /** Claim a notification key. Undefined means another update already claimed it. */
  public claim(input: CreateNotificationInput): Notification | undefined {
    return this.db
      .insert(notifications)
      .values({
        matchId: input.matchId,
        notificationType: input.notificationType,
        transitionKey: input.transitionKey,
        sentAt: input.sentAt ?? new Date(),
      })
      .onConflictDoNothing({
        target: [
          notifications.matchId,
          notifications.notificationType,
          notifications.transitionKey,
        ],
      })
      .returning()
      .get();
  }

  /** Claims the one daily weather forecast shared by all matches in a chat. */
  public claimWeatherForecastDay(input: {
    matchId: number;
    transitionKey: string;
    sentAt?: Date;
  }): Notification | undefined {
    return this.db
      .insert(notifications)
      .values({
        matchId: input.matchId,
        notificationType: "weather_forecast",
        transitionKey: input.transitionKey,
        sentAt: input.sentAt ?? new Date(),
      })
      .onConflictDoNothing()
      .returning()
      .get();
  }

  public createIfAbsent(input: CreateNotificationInput): Notification | undefined {
    return this.claim(input);
  }

  public delete(id: number): boolean {
    return this.db.delete(notifications).where(eq(notifications.id, id)).run().changes > 0;
  }

  public listByMatchId(matchId: number): Notification[] {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.matchId, matchId))
      .orderBy(desc(notifications.sentAt))
      .all();
  }
}

export function createNotificationsRepository(db: AppDatabase): NotificationsRepository {
  return new NotificationsRepository(db);
}
