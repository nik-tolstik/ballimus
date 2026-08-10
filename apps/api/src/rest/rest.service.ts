import { Inject, Injectable } from "@nestjs/common";
import {
  calendarDateInTimeZone,
  formatTimeInTimeZone,
  parseLocalDateTime,
} from "@football/domain";
import {
  MatchMessagesRepository,
  MatchesRepository,
  OutboxRepository,
  VenuesRepository,
  withTransaction,
  type AppDatabase,
  type Match as DbMatch,
  type MatchMessage,
  type TransactionRepositories,
  type Venue as DbVenue,
} from "@football/db";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { APP_DATABASE } from "../database/database.constants.js";
import { OutboxBestEffortService } from "../telegram/outbox-best-effort.service.js";
import { CurrentWeatherService } from "../weather/current-weather.service.js";
import { canonicalRequestHash } from "./rest.canonical.js";
import {
  type MatchCreateDto,
  type MatchListQueryDto,
  type PatchMatchDto,
  type VenueCreateDto,
  type VenueListQueryDto,
  type VenueUpdateDto,
} from "./rest.dto.js";
import { restRequestError, toRestHttpException } from "./rest.errors.js";
import { serializeRestObject, type RestJsonValue } from "./rest.serialization.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

type ReadRepositories = Pick<TransactionRepositories, "matches" | "matchMessages" | "venues" | "outbox">;
type MutationRepositories = Pick<TransactionRepositories, "matches" | "matchMessages" | "venues" | "outbox" | "idempotency">;

function readRepositories(db: AppDatabase): ReadRepositories {
  return {
    matches: new MatchesRepository(db),
    matchMessages: new MatchMessagesRepository(db),
    venues: new VenuesRepository(db),
    outbox: new OutboxRepository(db),
  };
}

function requiredKey(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw toRestHttpException(restRequestError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for mutations."));
  }
  return value.trim();
}

/** Parses a strong version value supplied through the HTTP If-Match header. */
export function parseIfMatch(value: string | undefined, required: boolean): number | undefined {
  if (value === undefined || value.trim() === "") {
    if (required) {
      throw toRestHttpException(restRequestError(428, "IF_MATCH_REQUIRED", "If-Match is required for this mutation."));
    }
    return undefined;
  }
  const normalized = value.trim().replace(/^"|"$/gu, "");
  if (!/^\d+$/u.test(normalized)) {
    throw toRestHttpException(restRequestError(400, "IF_MATCH_INVALID", "If-Match must contain a positive match version."));
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw toRestHttpException(restRequestError(400, "IF_MATCH_INVALID", "If-Match must contain a safe match version."));
  }
  return parsed;
}

/** Owner API for venue catalog and read-only Telegram match cards. */
@Injectable()
export class OwnerRestService {
  public constructor(
    @Inject(APP_DATABASE) private readonly db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(OutboxBestEffortService) private readonly bestEffort: OutboxBestEffortService,
    @Inject(CurrentWeatherService) private readonly weather: CurrentWeatherService,
  ) {}

  public async getBootstrap(ownerTelegramUserId: bigint): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const repositories = readRepositories(this.db);
    const matches = await repositories.matches.list({ telegramChatId: this.config.telegramGroupChatId });
    return serializeRestObject({
      owner: { telegramUserId: ownerTelegramUserId },
      group: {
        telegramChatId: this.config.telegramGroupChatId,
        generalTopicId: this.config.telegramGeneralTopicId,
        weatherTopicId: this.config.telegramChatTopicId,
        timezone: this.config.groupTimezone,
      },
      matches: await Promise.all(matches.map(async (match) => this.matchBody(match, repositories))),
    });
  }

  public async listMatches(ownerTelegramUserId: bigint, query: MatchListQueryDto): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const repositories = readRepositories(this.db);
    const matches = await repositories.matches.list({
      telegramChatId: this.config.telegramGroupChatId,
      ...(query.venueId === undefined ? {} : { venueId: BigInt(query.venueId) }),
    });
    return serializeRestObject({ matches: await Promise.all(matches.map(async (match) => this.matchBody(match, repositories))) });
  }

  public async getMatch(ownerTelegramUserId: bigint, matchId: bigint): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    try {
      const repositories = readRepositories(this.db);
      const match = await repositories.matches.getById(matchId);
      this.assertCurrentMatch(match);
      return serializeRestObject({ match: await this.matchBody(match, repositories) });
    } catch (error) {
      throw toRestHttpException(error);
    }
  }

  public async createMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    input: MatchCreateDto,
  ): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const scheduledAt = this.toScheduledAt(input.date, input.time);
    const body = await this.mutate(ownerTelegramUserId, idempotencyKey, { operation: "create-match", input }, 201, async (repositories) => {
      try {
        const venue = await repositories.venues.getForUpdate(BigInt(input.venueId));
        this.assertActiveVenue(venue);
        const match = await repositories.matches.create({
          telegramChatId: this.config.telegramGroupChatId,
          scheduledAt,
          venueId: venue.id,
          ...(input.fieldPriceRubles === undefined ? {} : { fieldPriceRubles: input.fieldPriceRubles }),
          creatorTelegramUserId: ownerTelegramUserId,
        });
        await repositories.matchMessages.createPending(match.id, this.config.telegramGroupChatId, this.config.telegramGeneralTopicId);
        await repositories.outbox.insertInTransaction({
          eventType: "publish_public_card",
          deduplicationKey: `match:${match.id.toString(10)}:publish`,
          matchId: match.id,
          telegramChatId: this.config.telegramGroupChatId,
          telegramTopicId: this.config.telegramGeneralTopicId,
        });
        return serializeRestObject({ match: await this.matchBody(match, repositories) });
      } catch (error) {
        throw toRestHttpException(error);
      }
    });
    await this.tryDeliverOutbox();
    return body;
  }

  public async patchMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatch: string | undefined,
    matchId: bigint,
    input: PatchMatchDto,
  ): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const expectedVersion = parseIfMatch(ifMatch, true);
    if (expectedVersion === undefined) throw new Error("If-Match was required but not provided");
    if (input.date === undefined && input.time === undefined && input.venueId === undefined && input.fieldPriceRubles === undefined) {
      throw toRestHttpException(restRequestError(400, "MATCH_PATCH_EMPTY", "Provide at least one match field to update."));
    }
    const body = await this.mutate(ownerTelegramUserId, idempotencyKey, { operation: "patch-match", matchId, expectedVersion, input }, 200, async (repositories) => {
      try {
        const current = await repositories.matches.getForUpdate(matchId);
        this.assertCurrentMatch(current);
        const date = input.date ?? calendarDateInTimeZone(current.scheduledAt, this.config.groupTimezone);
        const time = input.time ?? formatTimeInTimeZone(current.scheduledAt, this.config.groupTimezone);
        const venueId = input.venueId === undefined ? undefined : BigInt(input.venueId);
        if (venueId !== undefined) this.assertActiveVenue(await repositories.venues.getForUpdate(venueId));
        const updated = await repositories.matches.update(matchId, {
          expectedVersion,
          ...(input.date === undefined && input.time === undefined ? {} : { scheduledAt: this.toScheduledAt(date, time) }),
          ...(venueId === undefined ? {} : { venueId }),
          ...(input.fieldPriceRubles === undefined ? {} : { fieldPriceRubles: input.fieldPriceRubles }),
        });
        const reference = await repositories.matchMessages.findByMatchId(updated.id);
        if (reference?.publicationState === "published") await this.enqueueRefresh(repositories, updated);
        return serializeRestObject({ match: await this.matchBody(updated, repositories) });
      } catch (error) {
        throw toRestHttpException(error);
      }
    });
    await this.tryDeliverOutbox();
    return body;
  }

  public async deleteMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatch: string | undefined,
    matchId: bigint,
  ): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const expectedVersion = parseIfMatch(ifMatch, true);
    if (expectedVersion === undefined) throw new Error("If-Match was required but not provided");
    const body = await this.mutate(ownerTelegramUserId, idempotencyKey, { operation: "delete-match", matchId, expectedVersion }, 200, async (repositories) => {
      try {
        const deleted = await repositories.matches.requestDeletion(matchId, expectedVersion);
        const reference = await repositories.matchMessages.findByMatchId(matchId);
        await repositories.outbox.insertInTransaction({
          eventType: "delete_public_card",
          deduplicationKey: `match:${matchId.toString(10)}:delete`,
          matchId,
          telegramChatId: deleted.telegramChatId,
          telegramTopicId: reference?.telegramTopicId ?? this.config.telegramGeneralTopicId,
          payload: reference?.telegramMessageId === null || reference?.telegramMessageId === undefined
            ? {}
            : { telegramMessageId: reference.telegramMessageId.toString(10) },
        });
        return serializeRestObject({ deleted: true, matchId });
      } catch (error) {
        throw toRestHttpException(error);
      }
    });
    await this.tryDeliverOutbox();
    return body;
  }

  public async listVenues(ownerTelegramUserId: bigint, query: VenueListQueryDto): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    try {
      const venues = await new VenuesRepository(this.db).list({ includeArchived: query.includeArchived === true });
      return serializeRestObject({ venues: venues.map((venue) => this.venueBody(venue)) });
    } catch (error) {
      throw toRestHttpException(error);
    }
  }

  public async createVenue(ownerTelegramUserId: bigint, idempotencyKey: string | undefined, input: VenueCreateDto): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    return this.mutate(ownerTelegramUserId, idempotencyKey, { operation: "create-venue", input }, 201, async (repositories) => {
      try {
        const venue = await repositories.venues.create(input);
        return serializeRestObject({ venue: this.venueBody(venue) });
      } catch (error) {
        throw toRestHttpException(error);
      }
    });
  }

  public async updateVenue(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatch: string | undefined,
    venueId: bigint,
    input: VenueUpdateDto,
  ): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const expectedVersion = parseIfMatch(ifMatch, true);
    if (expectedVersion === undefined) throw new Error("If-Match was required but not provided");
    const body = await this.mutate(ownerTelegramUserId, idempotencyKey, { operation: "update-venue", venueId, expectedVersion, input }, 200, async (repositories) => {
      try {
        const venue = await repositories.venues.update(venueId, { ...input, expectedVersion });
        const affectedMatches = await repositories.matches.list({ venueId: venue.id });
        for (const match of affectedMatches) {
          const reference = await repositories.matchMessages.findByMatchId(match.id);
          if (reference?.publicationState === "published") await this.enqueueRefresh(repositories, match);
        }
        return serializeRestObject({ venue: this.venueBody(venue) });
      } catch (error) {
        throw toRestHttpException(error);
      }
    });
    await this.tryDeliverOutbox();
    return body;
  }

  public async setVenueArchived(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatch: string | undefined,
    venueId: bigint,
    archived: boolean,
  ): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const expectedVersion = parseIfMatch(ifMatch, true);
    return this.mutate(ownerTelegramUserId, idempotencyKey, { operation: archived ? "archive-venue" : "restore-venue", venueId, expectedVersion }, 200, async (repositories) => {
      try {
        const venue = await repositories.venues.setArchived(venueId, archived, expectedVersion);
        return serializeRestObject({ venue: this.venueBody(venue) });
      } catch (error) {
        throw toRestHttpException(error);
      }
    });
  }

  public async sendCurrentWeather(ownerTelegramUserId: bigint): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    try {
      const weather = await this.weather.sendCurrentWeather();
      return serializeRestObject({ sent: true, observedAt: weather.observedAt });
    } catch {
      throw toRestHttpException(restRequestError(502, "WEATHER_UNAVAILABLE", "Current weather could not be sent. Try again shortly."));
    }
  }

  private async mutate(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    request: Record<string, unknown>,
    status: number,
    operation: (repositories: MutationRepositories) => Promise<Record<string, RestJsonValue>>,
  ): Promise<Record<string, unknown>> {
    const key = requiredKey(idempotencyKey);
    try {
      return await withTransaction(this.db, async (repositories) => {
        const begin = await repositories.idempotency.beginInTransaction({
          ownerTelegramUserId,
          idempotencyKey: key,
          requestHash: canonicalRequestHash(request),
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        });
        if (begin.status === "in_progress") {
          throw toRestHttpException(restRequestError(409, "IDEMPOTENCY_IN_PROGRESS", "The same mutation is already being processed."));
        }
        if (begin.status === "replay") {
          if (begin.record.responseBody === null || begin.record.responseStatus === null) {
            throw toRestHttpException(restRequestError(409, "IDEMPOTENCY_RESPONSE_MISSING", "The stored mutation response is unavailable."));
          }
          return begin.record.responseBody;
        }
        const body = await operation(repositories);
        await repositories.idempotency.complete(begin.record.id, { status, body });
        return body;
      });
    } catch (error) {
      throw toRestHttpException(error);
    }
  }

  private async matchBody(match: DbMatch, repositories: ReadRepositories): Promise<Record<string, RestJsonValue>> {
    const [venue, reference] = await Promise.all([
      repositories.venues.getById(match.venueId),
      repositories.matchMessages.findByMatchId(match.id),
    ]);
    return serializeRestObject({
      id: match.id,
      chatId: match.telegramChatId,
      scheduledAt: match.scheduledAt,
      schedule: {
        date: calendarDateInTimeZone(match.scheduledAt, this.config.groupTimezone),
        time: formatTimeInTimeZone(match.scheduledAt, this.config.groupTimezone),
        timezone: this.config.groupTimezone,
      },
      venue: this.venueBody(venue),
      fieldPriceRubles: match.fieldPriceRubles,
      version: match.version,
      creatorTelegramUserId: match.creatorTelegramUserId,
      deletionRequestedAt: match.deletionRequestedAt,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      publicCard: this.publicCardBody(reference),
    });
  }

  private venueBody(venue: DbVenue): Record<string, RestJsonValue> {
    return serializeRestObject({
      id: venue.id,
      name: venue.name,
      mapUrl: venue.mapUrl,
      venueType: venue.venueType,
      bookingContacts: venue.bookingContacts,
      websiteUrl: venue.websiteUrl,
      archivedAt: venue.archivedAt,
      version: venue.version,
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt,
    });
  }

  private publicCardBody(reference: MatchMessage | undefined): Record<string, RestJsonValue> {
    return serializeRestObject({
      publicationState: reference?.publicationState ?? "not_published",
      telegramMessageId: reference?.telegramMessageId ?? null,
      publicationAttemptedAt: reference?.publicationAttemptedAt ?? null,
      lastError: reference?.lastError ?? null,
    });
  }

  private async enqueueRefresh(repositories: Pick<TransactionRepositories, "outbox">, match: DbMatch): Promise<void> {
    await repositories.outbox.insertInTransaction({
      eventType: "refresh_public_card",
      deduplicationKey: `match:${match.id.toString(10)}:refresh:${match.version}`,
      matchId: match.id,
      telegramChatId: match.telegramChatId,
      telegramTopicId: this.config.telegramGeneralTopicId,
    });
  }

  private toScheduledAt(date: string, time: string): Date {
    try {
      return parseLocalDateTime(date, time, this.config.groupTimezone);
    } catch {
      throw toRestHttpException(restRequestError(400, "SCHEDULE_INVALID", "Date and time must form a real local time."));
    }
  }

  private assertOwner(ownerTelegramUserId: bigint): void {
    if (ownerTelegramUserId !== this.config.telegramOwnerUserId) {
      throw toRestHttpException(restRequestError(403, "TELEGRAM_OWNER_REQUIRED", "This API is restricted to the configured owner."));
    }
  }

  private assertCurrentMatch(match: DbMatch): void {
    if (match.telegramChatId !== this.config.telegramGroupChatId || match.deletionRequestedAt !== null) {
      throw toRestHttpException(restRequestError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found."));
    }
  }

  private assertActiveVenue(venue: DbVenue): void {
    if (venue.archivedAt !== null) {
      throw toRestHttpException(restRequestError(409, "VENUE_ARCHIVED", "An archived venue cannot be used for a match."));
    }
  }

  private async tryDeliverOutbox(): Promise<void> {
    try {
      await this.bestEffort.dispatch();
    } catch {
      // The durable outbox runner retries delivery without failing the owner mutation.
    }
  }
}
