import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  matches,
  matchStatuses,
  type Match,
  type MatchStatus,
  type VenueType,
} from "../schema.js";

export interface CreateMatchInput {
  chatId: number;
  scheduledAt: Date | null;
  location: string | null;
  venueType?: VenueType | null;
  fieldPriceRubles?: number | null;
  title?: string | null;
  requiredPlayers: number;
  creatorTelegramUserId: number;
  status?: MatchStatus;
  createdAt?: Date;
}

export interface UpdateMatchInput {
  scheduledAt?: Date;
  location?: string;
  requiredPlayers?: number;
  status?: MatchStatus;
  venueType?: VenueType | null;
  cancellationReason?: string | null;
}

export class MatchesRepository {
  public constructor(private readonly db: AppDatabase) {}

  public findById(id: number): Match | undefined {
    return this.db.select().from(matches).where(eq(matches.id, id)).get();
  }

  public getById(id: number): Match | undefined {
    return this.findById(id);
  }

  public listByChatId(chatId: number): Match[] {
    return this.db
      .select()
      .from(matches)
      .where(eq(matches.chatId, chatId))
      .orderBy(desc(matches.scheduledAt))
      .all();
  }

  public listByStatus(chatId: number, status: MatchStatus): Match[] {
    return this.db
      .select()
      .from(matches)
      .where(and(eq(matches.chatId, chatId), eq(matches.status, status)))
      .orderBy(desc(matches.scheduledAt))
      .all();
  }

  /** Returns publishable matches that start within an inclusive time window. */
  public listScheduledBetween(start: Date, end: Date): Match[] {
    return this.db
      .select()
      .from(matches)
      .where(
        and(
          inArray(matches.status, ["active", "confirmed"]),
          gte(matches.scheduledAt, start),
          lte(matches.scheduledAt, end),
        ),
      )
      .orderBy(matches.scheduledAt)
      .all();
  }

  public create(input: CreateMatchInput): Match {
    const now = new Date();
    const record = this.db
      .insert(matches)
      .values({
        chatId: input.chatId,
        scheduledAt: input.scheduledAt,
        location: input.location,
        venueType: input.venueType ?? null,
        fieldPriceRubles: input.fieldPriceRubles ?? null,
        title: input.title ?? null,
        requiredPlayers: input.requiredPlayers,
        creatorTelegramUserId: input.creatorTelegramUserId,
        status: input.status ?? matchStatuses[0],
        createdAt: input.createdAt ?? now,
        updatedAt: now,
      })
      .returning()
      .get();

    if (!record) {
      throw new Error("Match was not created");
    }

    return record;
  }

  public update(id: number, input: UpdateMatchInput): Match | undefined {
    const values: {
      scheduledAt?: Date;
      location?: string;
      requiredPlayers?: number;
      status?: MatchStatus;
      venueType?: VenueType | null;
      cancellationReason?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (input.scheduledAt !== undefined) values.scheduledAt = input.scheduledAt;
    if (input.location !== undefined) values.location = input.location;
    if (input.requiredPlayers !== undefined) values.requiredPlayers = input.requiredPlayers;
    if (input.status !== undefined) values.status = input.status;
    if (input.venueType !== undefined) values.venueType = input.venueType;
    if (input.cancellationReason !== undefined) values.cancellationReason = input.cancellationReason;

    return this.db.update(matches).set(values).where(eq(matches.id, id)).returning().get();
  }

  public updateStatus(id: number, status: MatchStatus): Match | undefined {
    return this.update(id, { status });
  }

  public delete(id: number): boolean {
    return this.db.delete(matches).where(eq(matches.id, id)).run().changes > 0;
  }
}

export function createMatchesRepository(db: AppDatabase): MatchesRepository {
  return new MatchesRepository(db);
}

export { matchStatuses };
