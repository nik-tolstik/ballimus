import { HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import {
  assertValidCreateMatchInput,
  deriveMatchPlanningStage,
  evaluateMatchTransition,
  formatMatchCardTitle,
  formatWeekdayCalendarDate,
  getZonedDateParts,
  isWeatherForecastEligible,
  parseLocalDateTime,
  renderMatchCard,
  selectedTimeForFinalTime,
  type Match as DomainMatch,
  type MatchTimeMode,
  type ExternalParticipant as DomainExternalParticipant,
  type Vote as DomainVote,
} from "@football/domain";
import {
  APP_DATABASE,
} from "../database/index.js";
import {
  type AppDatabase,
  type ExternalParticipant as DbExternalParticipant,
  type Match as DbMatch,
  type MatchMessage as DbMatchMessage,
  type Player as DbPlayer,
  type PlayerUsername as DbPlayerUsername,
  type Vote as DbVote,
  ExternalParticipantsRepository,
  HttpIdempotencyRepository,
  MatchMessagesRepository,
  MatchesRepository,
  NotFoundRepositoryError,
  OptimisticConcurrencyError,
  OutboxRepository,
  PlayerUsernamesRepository,
  PlayersRepository,
  type TransactionRepositories,
  VotesRepository,
  withTransaction,
} from "@football/db";

import { API_CONFIG, type ApiConfig } from "../config/api-config.module.js";
import { OutboxBestEffortService } from "../telegram/outbox-best-effort.service.js";
import { WeatherRunner } from "../jobs/weather.runner.js";
import {
  claimLifecycleNotificationEvent,
  claimThresholdNotificationEvent,
} from "../notifications/notification-events.js";
import {
  mapRestError,
  restRequestError,
  toRestHttpException,
} from "./rest.errors.js";
import { canonicalRequestHash } from "./rest.canonical.js";
import {
  type CancelMatchDto,
  type CreateAliasDto,
  type ExternalParticipantCreateDto,
  type ExternalParticipantUpdateDto,
  type FinalizeMatchDto,
  type MatchCreateDto,
  type MatchListQueryDto,
  type PatchMatchDto,
  type PlayerListQueryDto,
  type RefreshMatchDto,
  type ReconcileMatchDto,
  type UpdateAliasDto,
  type UpdatePlayerDto,
  type VoteCorrectionDto,
} from "./rest.dto.js";
import { serializeRestObject, type RestJsonValue } from "./rest.serialization.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_CARD_TOPIC_ID_FOR_GENERAL = 1n;
const MANUAL_WEATHER_FORECAST_LEAD_TIME_MS = 16 * 24 * 60 * 60 * 1000;

type RestRepositories = Pick<
  TransactionRepositories,
  | "matches"
  | "matchMessages"
  | "players"
  | "playerUsernames"
  | "votes"
  | "externalParticipants"
  | "idempotency"
  | "outbox"
>;

interface RosterCountsBody {
  readonly goingVotes: number;
  readonly externalParticipants: number;
  readonly goingCount: number;
  readonly requiredPlayers: number;
  readonly thresholdReached: boolean;
  readonly remainingToThreshold: number;
}

interface PublicCardBody {
  readonly publicationState: string;
  readonly reconciliationState: "none" | "pending" | "uncertain" | "failed";
  readonly reconciliationRequired: boolean;
  readonly telegramChatId: string | null;
  readonly telegramTopicId: string | null;
  readonly telegramMessageId: string | null;
  readonly publicationAttemptedAt: string | null;
  readonly publicationUncertainAt: string | null;
}

interface MatchDetailsBody extends Record<string, unknown> {
  readonly id: string;
  readonly chatId: string;
  readonly scheduledAt: string | null;
  readonly timeMode: MatchTimeMode;
  readonly timeOptions: readonly string[];
  readonly selectedTime: string | null;
  readonly schedule: {
    readonly date: string | null;
    readonly time: string | null;
    readonly timezone: string;
  };
  readonly location: string | null;
  readonly venueType: string | null;
  readonly fieldPriceRubles: number | null;
  readonly title: string | null;
  readonly displayTitle: string;
  readonly requiredPlayers: number;
  readonly status: string;
  readonly planningStage: "recruiting_players" | "finalizing_details" | "ready_to_confirm" | null;
  readonly version: number;
  readonly cancellationReason: string | null;
  readonly creatorTelegramUserId: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly roster: {
    readonly counts: RosterCountsBody;
    readonly votes: readonly Record<string, unknown>[];
    readonly externalParticipants: readonly Record<string, unknown>[];
  };
  readonly publicCard: PublicCardBody;
}

interface PlayerBody extends Record<string, unknown> {
  readonly id: string;
  readonly telegramUserId: string | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly confirmed: boolean;
  readonly confirmationState: "confirmed" | "unconfirmed";
  readonly telegramUsernameSnapshot: string | null;
  readonly telegramFirstNameSnapshot: string | null;
  readonly telegramLastNameSnapshot: string | null;
  readonly telegramLanguageCode: string | null;
  readonly usernames: readonly Record<string, unknown>[];
}

interface MatchAggregate {
  readonly match: DbMatch;
  readonly message: DbMatchMessage | undefined;
  readonly votes: readonly DbVote[];
  readonly externalParticipants: readonly DbExternalParticipant[];
  readonly counts: RosterCountsBody;
  readonly currentReadableNames: ReadonlyMap<bigint, string | null>;
  readonly currentPlayers: ReadonlyMap<bigint, DbPlayer>;
}

function playerAvatarUrl(player: DbPlayer | undefined): string | null {
  if (
    player === undefined
    || typeof player.avatarContentType !== "string"
    || typeof player.avatarDataBase64 !== "string"
  ) {
    return null;
  }
  return `data:${player.avatarContentType};base64,${player.avatarDataBase64}`;
}

interface IdempotencyReplay {
  readonly kind: "replay";
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

interface IdempotencyInProgress {
  readonly kind: "in_progress";
}

interface IdempotencySuccess {
  readonly kind: "success";
  readonly body: Record<string, RestJsonValue>;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readRepositories(db: AppDatabase): RestRepositories {
  return {
    matches: new MatchesRepository(db),
    matchMessages: new MatchMessagesRepository(db),
    players: new PlayersRepository(db),
    playerUsernames: new PlayerUsernamesRepository(db),
    votes: new VotesRepository(db),
    externalParticipants: new ExternalParticipantsRepository(db),
    idempotency: new HttpIdempotencyRepository(db),
    outbox: new OutboxRepository(db),
  };
}


function formatDerivedTitle(input: {
  readonly date: string;
  readonly time: string | null;
  readonly location: string | null;
  readonly fieldPriceRubles?: number | null;
  readonly dateLabel?: string;
  readonly timeLabel?: string;
  readonly timeMode?: MatchTimeMode;
}): string {
  const date = formatWeekdayCalendarDate(input.date);
  const time = input.timeLabel ?? input.time ?? ((input.timeMode ?? "exact") !== "exact" ? "время выбираем" : "время уточняется");
  const priceLabel = input.fieldPriceRubles === undefined || input.fieldPriceRubles === null
    ? undefined
    : `${input.fieldPriceRubles} рублей`;
  const details = [input.location, priceLabel].filter(
    (value): value is string => value !== undefined && value !== null && value !== "",
  );
  const suffix = details.length === 0
    ? ""
    : priceLabel === undefined
      ? ` — ${details[0]}`
      : ` (${details.join(", ")})`;
  return `${date} · ${time}${suffix}`;
}

export function parseIfMatch(value: string | undefined, required: boolean): number | undefined {
  if (value === undefined || value.trim() === "") {
    if (required) {
      throw toRestHttpException(restRequestError(
        428,
        "IF_MATCH_REQUIRED",
        "If-Match is required when editing a match.",
      ));
    }
    return undefined;
  }
  const normalized = value.trim();
  const match = /^(?:W\/)?(?:"([1-9]\d*)"|([1-9]\d*))$/u.exec(normalized);
  const versionText = match?.[1] ?? match?.[2];
  if (versionText === undefined) {
    throw toRestHttpException(restRequestError(400, "IF_MATCH_INVALID", "If-Match must contain a positive match version."));
  }
  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw toRestHttpException(restRequestError(400, "IF_MATCH_INVALID", "If-Match must contain a safe match version."));
  }
  return version;
}

function toDomainMatch(match: DbMatch): DomainMatch {
  return {
    id: match.id,
    chatId: match.telegramChatId,
    scheduledAt: match.scheduledAt,
    scheduleDate: match.scheduleDate,
    timeMode: match.timeMode,
    timeOptions: match.timeOptions,
    selectedTime: match.selectedTime,
    location: match.location,
    venueType: match.venueType,
    fieldPriceRubles: match.fieldPriceRubles,
    title: match.title,
    requiredPlayers: match.requiredPlayers,
    status: match.status,
    cancellationReason: match.cancellationReason,
    creatorTelegramUserId: match.creatorTelegramUserId,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
}

function toDomainVote(vote: DbVote): DomainVote {
  return {
    matchId: vote.matchId,
    telegramUserId: vote.telegramUserId,
    usernameSnapshot: vote.usernameSnapshot,
    displayNameSnapshot: vote.displayNameSnapshot,
    option: vote.option,
    availableAfter: vote.availableAfter,
    exactTimes: vote.exactTimes,
    updatedAt: vote.updatedAt,
  };
}

function toDomainExternalParticipant(
  participant: DbExternalParticipant,
): DomainExternalParticipant {
  return {
    id: participant.id,
    matchId: participant.matchId,
    addedByTelegramUserId: participant.createdByTelegramUserId,
    ...(participant.sourceUpdateId === null ? {} : { sourceUpdateId: participant.sourceUpdateId }),
    sourceLabel: participant.displayName,
    displayNameSnapshot: participant.displayName,
    availableAfter: participant.availableAfter,
    quantity: participant.quantity,
    createdAt: participant.createdAt,
  };
}

function publicCardTopicId(config: ApiConfig): bigint | null {
  return config.telegramGeneralTopicId === PUBLIC_CARD_TOPIC_ID_FOR_GENERAL
    ? null
    : config.telegramGeneralTopicId;
}

@Injectable()
export class OwnerRestService {
  private readonly weatherMatches: Pick<MatchesRepository, "getById">;

  public constructor(
    @Inject(APP_DATABASE) private readonly db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() @Inject(OutboxBestEffortService) private readonly outboxBestEffort?: OutboxBestEffortService,
    @Optional() @Inject(WeatherRunner) private readonly weatherRunner?: WeatherRunner,
    @Optional() weatherMatches?: MatchesRepository,
  ) {
    this.weatherMatches = weatherMatches ?? new MatchesRepository(db);
  }

  public async getBootstrap(ownerTelegramUserId: bigint): Promise<Record<string, unknown>> {
    return this.read(ownerTelegramUserId, async () => {
      const repositories = readRepositories(this.db);
      const matches = await repositories.matches.list({ telegramChatId: this.config.telegramGroupChatId });
      const summaries = await Promise.all(matches.map(async (match) => {
        const aggregate = await this.loadAggregate(repositories, match.id);
        return this.toSummary(aggregate);
      }));
      return {
        owner: { telegramUserId: ownerTelegramUserId },
        group: {
          telegramChatId: this.config.telegramGroupChatId,
          generalTopicId: this.config.telegramGeneralTopicId,
          chatTopicId: this.config.telegramChatTopicId,
        },
        timezone: this.config.groupTimezone,
        matches: this.groupSummaries(summaries),
      };
    });
  }

  public async listMatches(
    ownerTelegramUserId: bigint,
    query: MatchListQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.read(ownerTelegramUserId, async () => {
      const repositories = readRepositories(this.db);
      const hasSearch = query.search !== undefined;
      const records = await repositories.matches.list({
        telegramChatId: this.config.telegramGroupChatId,
        ...(query.status === undefined ? {} : { statuses: [query.status] }),
        ...(hasSearch || query.limit === undefined ? {} : { limit: query.limit }),
        ...(hasSearch || query.offset === undefined ? {} : { offset: query.offset }),
      });
      const filtered = hasSearch
        ? records.filter((match) => {
          const needle = query.search?.toLocaleLowerCase("en-US") ?? "";
          return [match.title, match.location]
            .filter((value): value is string => value !== null)
            .some((value) => value.toLocaleLowerCase("en-US").includes(needle));
        })
        : records;
      const paged = hasSearch
        ? filtered.slice(query.offset ?? 0, query.limit === undefined ? undefined : (query.offset ?? 0) + query.limit)
        : filtered;
      const summaries = await Promise.all(paged.map(async (match) => this.toSummary(await this.loadAggregate(repositories, match.id))));
      return { matches: summaries };
    });
  }

  public async getMatch(ownerTelegramUserId: bigint, matchId: bigint): Promise<Record<string, unknown>> {
    return this.read(ownerTelegramUserId, async () => {
      const aggregate = await this.loadAggregate(readRepositories(this.db), matchId);
      return { match: this.toDetails(aggregate) };
    });
  }

  public async createMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    input: MatchCreateDto,
  ): Promise<Record<string, unknown>> {
    const matchInput = this.normalizeCreateInput(input);
    const scheduledAt = this.scheduledAt(matchInput.date, matchInput.time);
    const title = formatDerivedTitle(matchInput);
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: "/matches",
      body: input,
    }, 201, async (repositories) => {
      const match = await repositories.matches.create({
        telegramChatId: this.config.telegramGroupChatId,
        scheduledAt,
        scheduleDate: matchInput.date,
        timeMode: matchInput.timeMode ?? "exact",
        timeOptions: matchInput.timeOptions ?? [],
        location: matchInput.location,
        venueType: matchInput.venueType,
        fieldPriceRubles: matchInput.fieldPriceRubles ?? null,
        title,
        requiredPlayers: matchInput.requiredPlayers,
        creatorTelegramUserId: ownerTelegramUserId,
        status: "active",
      });
      await repositories.matchMessages.createPending(
        match.id,
        match.telegramChatId,
        publicCardTopicId(this.config),
      );
      const aggregate = await this.loadAggregate(repositories, match.id);
      await this.enqueueCardEvent(
        repositories,
        match,
        "publish_public_card",
        `publish:public-card:${match.id.toString(10)}`,
        this.renderAggregate(aggregate),
      );
      return {
        match: this.toDetails(aggregate),
        action: { type: "publish_requested", outboxState: "pending" },
      };
    });
  }

  public async patchMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatchHeader: string | undefined,
    matchId: bigint,
    input: PatchMatchDto,
  ): Promise<Record<string, unknown>> {
    const expectedVersion = parseIfMatch(ifMatchHeader, true);
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "PATCH",
      path: `/matches/${matchId.toString(10)}`,
      body: input,
      ifMatch: expectedVersion,
    }, 200, async (repositories, requestHash, operationKey) => {
      const current = await this.getLockedConfiguredMatch(repositories, matchId);
      if (expectedVersion === undefined || current.version !== expectedVersion) {
        throw new OptimisticConcurrencyError(expectedVersion ?? 0, current.version);
      }
      const patch = this.patchValues(current, input);
      const movesPollVotesToFixedTime = current.timeMode !== "exact" && patch.timeMode === "exact";
      if (patch.timeMode !== undefined || patch.timeOptions !== undefined) {
        const currentVotes = await repositories.votes.listByMatchId(matchId);
        const currentExternalParticipants = await repositories.externalParticipants.listByMatchId(matchId);
        const goingVotes = currentVotes.filter((vote) => vote.option === "going");
        const externalAvailabilityParticipants = currentExternalParticipants.filter(
          (participant): participant is typeof participant & { readonly availableAfter: string } => participant.availableAfter !== null,
        );
        const nextMode = patch.timeMode ?? current.timeMode;
        const nextOptions = patch.timeOptions ?? current.timeOptions;
        const optionsChanged = nextOptions.length !== current.timeOptions.length
          || nextOptions.some((option, index) => option !== current.timeOptions[index]);
        if (current.status === "confirmed" && (nextMode !== current.timeMode || optionsChanged)) {
          throw restRequestError(
            409,
            "MATCH_CONFIRMED_TIME_LOCKED",
            "The time mode and availability options cannot be changed after confirmation.",
          );
        }
        if (
          nextMode !== current.timeMode
          && (goingVotes.length > 0 || externalAvailabilityParticipants.length > 0)
          && !movesPollVotesToFixedTime
        ) {
          throw restRequestError(
            409,
            "MATCH_TIME_MODE_HAS_VOTES",
            "The time mode cannot be changed after availability votes have been received.",
          );
        }
        if (nextMode !== "exact") {
          const nextOptionSet = new Set(nextOptions);
          const removedOptionHasVotes = goingVotes.some(
            (vote) => (vote.availableAfter !== null && !nextOptionSet.has(vote.availableAfter))
              || vote.exactTimes.some((time) => !nextOptionSet.has(time)),
          );
          const removedOptionHasExternalParticipants = externalAvailabilityParticipants.some(
            (participant) => !nextOptionSet.has(participant.availableAfter),
          );
          if (removedOptionHasVotes || removedOptionHasExternalParticipants) {
            throw restRequestError(
              409,
              "MATCH_TIME_OPTION_HAS_VOTES",
              "A time option with existing votes cannot be removed.",
            );
          }
        }
      }
      const countsBefore = await repositories.votes.rosterCounts(matchId);
      const updated = await repositories.matches.update(matchId, {
        ...patch,
        expectedVersion,
      });
      if (movesPollVotesToFixedTime) {
        await repositories.votes.clearGoingTimeSelections(matchId);
        await repositories.externalParticipants.clearTimeSelections(matchId);
      }
      if (updated.status === "active" || updated.status === "confirmed") {
        await this.enqueueRefreshForMatch(repositories, updated, requestHash);
        const countsAfter = await repositories.votes.rosterCounts(matchId);
        await this.enqueueThresholdNotification(repositories, {
          match: updated,
          countsAfter,
          thresholdReached: !countsBefore.thresholdReached && countsAfter.thresholdReached,
          thresholdLost: countsBefore.thresholdReached && !countsAfter.thresholdReached,
        }, operationKey);
      }
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "match_updated" },
      };
    });
  }

  public async previewMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/preview`,
    }, 200, async (repositories) => {
      const aggregate = await this.loadAggregate(repositories, matchId);
      const card = this.renderAggregate(aggregate);
      return {
        matchId,
        version: aggregate.match.version,
        title: formatMatchCardTitle(toDomainMatch(aggregate.match), { timezone: this.config.groupTimezone }),
        card,
      };
    });
  }

  public async publishMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatchHeader: string | undefined,
    matchId: bigint,
  ): Promise<Record<string, unknown>> {
    const expectedVersion = parseIfMatch(ifMatchHeader, false);
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/publish`,
      ifMatch: expectedVersion,
    }, 200, async (repositories) => {
      const current = await this.getLockedConfiguredMatch(repositories, matchId);
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new OptimisticConcurrencyError(expectedVersion, current.version);
      }
      const existing = await repositories.matchMessages.findByMatchId(matchId);
      if (existing?.publicationState === "uncertain" || existing?.publicationState === "failed") {
        throw restRequestError(
          409,
          "PUBLIC_CARD_RECONCILIATION_REQUIRED",
          "The previous publication is uncertain; reconcile the public card before publishing again.",
          { publicationState: existing.publicationState },
        );
      }
      if (existing?.publicationState === "published") {
        if (current.status !== "active") {
          throw restRequestError(
            409,
            "PUBLIC_CARD_STATE_CONFLICT",
            "The stored public-card state is incompatible with the match lifecycle state.",
            { publicationState: existing.publicationState, matchStatus: current.status },
          );
        }
        return {
          match: this.toDetails(await this.loadAggregate(repositories, matchId)),
          action: { type: "already_published", outboxState: "none" },
        };
      }
      if (current.status !== "draft" && current.status !== "active") {
        throw evaluateMatchTransition({ from: current.status, to: "active" });
      }
      const activeMatch = current.status === "draft"
        ? await repositories.matches.transitionStatus(matchId, {
          to: "active",
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        })
        : current;
      if (existing === undefined) {
        await repositories.matchMessages.createPending(
          matchId,
          activeMatch.telegramChatId,
          publicCardTopicId(this.config),
        );
      }
      const aggregate = await this.loadAggregate(repositories, matchId);
      const card = this.renderAggregate(aggregate);
      await this.enqueueCardEvent(
        repositories,
        activeMatch,
        "publish_public_card",
        `publish:public-card:${activeMatch.id.toString(10)}`,
        card,
      );
      return {
        match: this.toDetails(aggregate),
        action: { type: "publish_requested", outboxState: "pending" },
      };
    });
  }

  public async confirmMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatchHeader: string | undefined,
    matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.transitionMatch(ownerTelegramUserId, idempotencyKey, ifMatchHeader, matchId, "confirmed");
  }

  public async finalizeMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatchHeader: string | undefined,
    matchId: bigint,
    input: FinalizeMatchDto,
  ): Promise<Record<string, unknown>> {
    const expectedVersion = parseIfMatch(ifMatchHeader, false);
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/finalize`,
      body: input,
      ifMatch: expectedVersion,
    }, 200, async (repositories, requestHash) => {
      const current = await this.getLockedConfiguredMatch(repositories, matchId);
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new OptimisticConcurrencyError(expectedVersion, current.version);
      }
      if (current.status !== "active") {
        throw restRequestError(409, "MATCH_FINALIZATION_NOT_ALLOWED", "Only an active match can be finalized.");
      }
      if (current.scheduleDate === null) {
        throw restRequestError(400, "MATCH_SCHEDULE_DATE_REQUIRED", "Set the match date before finalization.");
      }
      const countsBefore = await repositories.votes.rosterCounts(matchId);
      if (!countsBefore.thresholdReached) {
        throw restRequestError(
          409,
          "MATCH_PLAYER_THRESHOLD_NOT_REACHED",
          "Reach the minimum player threshold before finalization.",
        );
      }

      const scheduledAt = this.scheduledAt(current.scheduleDate, input.time);
      if (scheduledAt === null) {
        throw restRequestError(400, "MATCH_TIME_INVALID", "Set a valid final match time.");
      }
      const selectedTime = selectedTimeForFinalTime(current.timeMode, current.timeOptions, input.time);
      if (current.timeMode === "availability" && selectedTime === undefined) {
        throw restRequestError(
          400,
          "MATCH_FINAL_TIME_BEFORE_AVAILABILITY",
          "The final time cannot be earlier than every availability option.",
        );
      }
      if (current.timeMode === "exact_options" && selectedTime === undefined) {
        throw restRequestError(
          400,
          "MATCH_FINAL_TIME_NOT_OPTION",
          "The final time must be one of the exact time options.",
        );
      }
      const location = input.location.trim();
      const updated = await repositories.matches.update(matchId, {
        scheduledAt,
        selectedTime: selectedTime ?? null,
        location,
        venueType: input.venueType ?? current.venueType,
        fieldPriceRubles: input.fieldPriceRubles,
        title: formatDerivedTitle({
          date: current.scheduleDate,
          time: input.time,
          timeMode: current.timeMode,
          location,
          fieldPriceRubles: input.fieldPriceRubles,
        }),
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      });
      const countsAfter = await repositories.votes.rosterCounts(matchId);
      if (!countsAfter.thresholdReached) {
        throw restRequestError(
          409,
          "MATCH_FINAL_TIME_BELOW_THRESHOLD",
          "Too few players are available by the selected final time.",
          { goingCount: countsAfter.goingCount, requiredPlayers: current.requiredPlayers },
        );
      }
      const next = await repositories.matches.transitionStatus(matchId, {
        to: "confirmed",
        expectedVersion: updated.version,
      });
      await this.enqueueRefreshForMatch(repositories, next, requestHash);
      const notification = await claimLifecycleNotificationEvent(
        repositories,
        next,
        this.config.telegramChatTopicId,
        this.config.groupTimezone,
        current.status,
      );
      if (notification !== undefined) await repositories.outbox.insertInTransaction(notification);
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "match_confirmed", outboxState: "pending" },
      };
    });
  }

  public async completeMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatchHeader: string | undefined,
    matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.transitionMatch(ownerTelegramUserId, idempotencyKey, ifMatchHeader, matchId, "completed");
  }

  public async cancelMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatchHeader: string | undefined,
    matchId: bigint,
    input: CancelMatchDto,
  ): Promise<Record<string, unknown>> {
    return this.transitionMatch(
      ownerTelegramUserId,
      idempotencyKey,
      ifMatchHeader,
      matchId,
      "cancelled",
      input.cancellationReason,
    );
  }

  public async refreshMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
    input: RefreshMatchDto | undefined,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/refresh`,
      body: input ?? {},
    }, 200, async (repositories, requestHash) => {
      const current = await this.getLockedConfiguredMatch(repositories, matchId);
      const eventType = await this.enqueueRefreshForMatch(repositories, current, requestHash);
      if (eventType === undefined) {
        const message = await repositories.matchMessages.findByMatchId(matchId);
        if (message?.publicationState === "uncertain" || message?.publicationState === "failed") {
          throw restRequestError(409, "PUBLIC_CARD_RECONCILIATION_REQUIRED", "Repair the uncertain public card before refreshing it.");
        }
        throw restRequestError(409, "PUBLIC_CARD_NOT_AVAILABLE", "This match has no published public card to refresh.");
      }
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "refresh_requested", outboxState: "pending", eventType },
      };
    });
  }

  public async sendWeatherForecast(
    ownerTelegramUserId: bigint,
    matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.read(ownerTelegramUserId, async () => {
      if (this.weatherRunner === undefined) {
        throw new Error("Weather delivery is unavailable");
      }

      const match = await this.weatherMatches.getById(matchId);
      this.assertConfiguredMatch(match);
      const now = new Date();
      const weatherMatch = {
        id: match.id,
        chatId: match.telegramChatId,
        status: match.status,
        venueType: match.venueType,
        scheduledAt: match.scheduledAt,
      };

      if (match.status !== "active" && match.status !== "confirmed") {
        throw restRequestError(409, "WEATHER_MATCH_NOT_ACTIVE", "Weather can only be sent for an active or confirmed match.");
      }
      if (match.venueType !== "outdoor") {
        throw restRequestError(409, "WEATHER_OUTDOOR_MATCH_REQUIRED", "Weather is only sent for outdoor matches.");
      }
      if (match.scheduledAt === null) {
        throw restRequestError(409, "WEATHER_MATCH_TIME_REQUIRED", "Set the exact match time before sending weather.");
      }
      if (!isWeatherForecastEligible({
        match: weatherMatch,
        now,
        leadTimeMs: MANUAL_WEATHER_FORECAST_LEAD_TIME_MS,
      })) {
        throw restRequestError(409, "WEATHER_FORECAST_NOT_AVAILABLE", "Weather can only be sent for a future match within the 16-day forecast window.");
      }

      const result = await this.weatherRunner.sendForecast(weatherMatch, now, "manual");
      if (result.status === "duplicate") {
        const source = result.notification.payload["source"];
        if (source === "manual") {
          throw restRequestError(409, "WEATHER_ALREADY_SENT_MANUALLY", "The owner already sent weather for this day.");
        }
        throw restRequestError(409, "WEATHER_ALREADY_SENT", "Weather has already been sent for this day.");
      }
      if (result.status === "failed") {
        throw restRequestError(502, "WEATHER_FORECAST_UNAVAILABLE", "The weather provider could not return a forecast.");
      }
      if (result.status === "uncertain") {
        throw restRequestError(502, "WEATHER_DELIVERY_UNCERTAIN", "Telegram delivery could not be confirmed; retrying could duplicate the forecast.");
      }

      return {
        matchId: match.id,
        weatherDay: result.weatherDay,
        status: "sent",
      };
    });
  }

  public async reconcileMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
    input: ReconcileMatchDto,
  ): Promise<Record<string, unknown>> {
    if (input.action === "attach" && input.telegramMessageId === undefined) {
      throw restRequestError(400, "TELEGRAM_MESSAGE_ID_REQUIRED", "telegramMessageId is required when attaching an existing card.");
    }
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/reconcile`,
      body: input,
    }, 200, async (repositories, requestHash, operationKey) => {
      const match = await this.getLockedConfiguredMatch(repositories, matchId);
      const message = await repositories.matchMessages.getByMatchId(matchId);
      if (message.publicationState !== "uncertain" && message.publicationState !== "failed") {
        throw restRequestError(409, "PUBLIC_CARD_RECONCILIATION_NOT_REQUIRED", "This public card does not require reconciliation.");
      }

      if (input.action === "attach") {
        await repositories.matchMessages.markPublished(matchId, input.telegramMessageId as string);
        if (match.status === "active" || match.status === "confirmed") {
          await this.enqueueRefreshForMatch(repositories, match, requestHash);
        } else {
          await this.enqueueDeleteForMatch(repositories, match);
        }
      } else if (match.status === "active" || match.status === "confirmed") {
        await repositories.matchMessages.resetForRetry(matchId);
        const aggregate = await this.loadAggregate(repositories, matchId);
        await this.enqueueCardEvent(
          repositories,
          match,
          "publish_public_card",
          `publish:public-card:${match.id.toString(10)}:repair:${operationKey}`,
          this.renderAggregate(aggregate),
        );
      } else {
        await repositories.matchMessages.markDeleted(matchId);
      }

      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: {
          type: input.action === "attach" ? "public_card_attached" : "public_card_retry_requested",
          outboxState: match.status === "active" || match.status === "confirmed" || input.action === "attach" ? "pending" : "none",
        },
      };
    });
  }

  public async correctVote(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
    input: VoteCorrectionDto,
  ): Promise<Record<string, unknown>> {
    if (input.playerId === undefined && input.telegramUserId === undefined) {
      throw restRequestError(400, "VOTE_TARGET_REQUIRED", "playerId or telegramUserId is required.");
    }
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/roster/votes`,
      body: input,
    }, 200, async (repositories, requestHash, operationKey) => {
      await this.getLockedConfiguredMatch(repositories, matchId);
      const result = await repositories.votes.correctByOwnerInTransaction({
        matchId,
        ownerTelegramUserId,
        ...(input.playerId === undefined ? {} : { playerId: input.playerId }),
        ...(input.telegramUserId === undefined ? {} : { telegramUserId: input.telegramUserId }),
        option: input.option,
        ...(input.availableAfter === undefined ? {} : { availableAfter: input.availableAfter }),
        ...(input.exactTimes === undefined ? {} : { exactTimes: input.exactTimes }),
      });
      await this.enqueueRefreshForMatch(repositories, result.match, requestHash);
      await this.enqueueThresholdNotification(repositories, result, operationKey);
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "vote_corrected", outboxState: "pending" },
      };
    });
  }

  public async removeVote(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
    playerId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "DELETE",
      path: `/matches/${matchId.toString(10)}/roster/votes/${playerId.toString(10)}`,
    }, 200, async (repositories, requestHash, operationKey) => {
      await this.getLockedConfiguredMatch(repositories, matchId);
      const result = await repositories.votes.removeByOwnerInTransaction({
        matchId,
        ownerTelegramUserId,
        playerId,
      });
      await this.enqueueRefreshForMatch(repositories, result.match, requestHash);
      await this.enqueueThresholdNotification(repositories, result, operationKey);
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "vote_removed", outboxState: "pending" },
      };
    });
  }

  public async addExternalParticipant(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
    input: ExternalParticipantCreateDto,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/roster/external-participants`,
      body: input,
    }, 200, async (repositories, requestHash, operationKey) => {
      await this.getLockedConfiguredMatch(repositories, matchId);
      const result = await repositories.externalParticipants.addQuantityInTransaction({
        matchId,
        ownerTelegramUserId,
        quantity: input.quantity,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.availableAfter === undefined ? {} : { availableAfter: input.availableAfter }),
      });
      await this.enqueueRefreshForMatch(repositories, result.match, requestHash);
      await this.enqueueThresholdNotification(repositories, result, operationKey);
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "external_participant_added", outboxState: "pending" },
      };
    });
  }

  public async updateExternalParticipant(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
    participantId: bigint,
    input: ExternalParticipantUpdateDto,
  ): Promise<Record<string, unknown>> {
    if (!hasOwn(input, "displayName") && !hasOwn(input, "availableAfter")) {
      throw restRequestError(400, "EXTERNAL_PARTICIPANT_UPDATE_EMPTY", "The participant name or availability must be changed.");
    }
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "PATCH",
      path: `/matches/${matchId.toString(10)}/roster/external-participants/${participantId.toString(10)}`,
      body: input,
    }, 200, async (repositories, requestHash, operationKey) => {
      const existing = await repositories.externalParticipants.findById(participantId);
      if (existing === undefined || existing.matchId !== matchId) throw new NotFoundRepositoryError("External participant was not found");
      this.assertConfiguredMatch(await repositories.matches.getById(matchId));
      const result = await repositories.externalParticipants.updateInTransaction({
        id: participantId,
        ownerTelegramUserId,
        ...(hasOwn(input, "displayName") ? { displayName: input.displayName ?? null } : {}),
        ...(hasOwn(input, "availableAfter") ? { availableAfter: input.availableAfter ?? null } : {}),
      });
      await this.enqueueRefreshForMatch(repositories, result.match, requestHash);
      await this.enqueueThresholdNotification(repositories, result, operationKey);
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "external_participant_updated", outboxState: "pending" },
      };
    });
  }

  public async removeExternalParticipant(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    matchId: bigint,
    participantId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "DELETE",
      path: `/matches/${matchId.toString(10)}/roster/external-participants/${participantId.toString(10)}`,
    }, 200, async (repositories, requestHash, operationKey) => {
      const existing = await repositories.externalParticipants.findById(participantId);
      if (existing === undefined || existing.matchId !== matchId) throw new NotFoundRepositoryError("External participant was not found");
      this.assertConfiguredMatch(await repositories.matches.getById(matchId));
      const result = await repositories.externalParticipants.removeInTransaction({ id: participantId, ownerTelegramUserId });
      await this.enqueueRefreshForMatch(repositories, result.match, requestHash);
      await this.enqueueThresholdNotification(repositories, result, operationKey);
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: { type: "external_participant_removed", outboxState: "pending" },
      };
    });
  }

  public async listPlayers(
    ownerTelegramUserId: bigint,
    query: PlayerListQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.read(ownerTelegramUserId, async () => {
      const repositories = readRepositories(this.db);
      const players = await repositories.players.list({
        ...(query.search === undefined ? {} : { search: query.search }),
        ...(query.confirmed === undefined ? {} : { confirmed: query.confirmed }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return { players: await Promise.all(players.map((player) => this.toPlayer(repositories, player))) };
    });
  }

  public async getPlayer(ownerTelegramUserId: bigint, playerId: bigint): Promise<Record<string, unknown>> {
    return this.read(ownerTelegramUserId, async () => {
      const repositories = readRepositories(this.db);
      return { player: await this.toPlayer(repositories, await repositories.players.getById(playerId)) };
    });
  }

  public async createAlias(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    input: CreateAliasDto,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: "/players/aliases",
      body: input,
    }, 200, async (repositories, requestHash) => {
      const result = await repositories.players.createAliasInTransaction({
        username: input.username,
        displayName: input.displayName,
        ...(input.playerId === undefined ? {} : { playerId: input.playerId }),
      });
      await this.enqueueRefreshForActiveMatches(repositories, requestHash);
      return {
        player: await this.toPlayer(repositories, result.player),
        alias: this.toUsername(result.username),
      };
    });
  }

  public async updateAlias(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    username: string,
    input: UpdateAliasDto,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "PATCH",
      path: `/players/aliases/${username}`,
      body: input,
    }, 200, async (repositories, requestHash) => {
      const alias = await repositories.playerUsernames.findByUsernameForUpdate(username);
      if (alias === undefined) throw new NotFoundRepositoryError("Username alias was not found");
      const result = await repositories.players.createAliasInTransaction({
        username,
        displayName: input.displayName,
        playerId: alias.playerId,
      });
      await this.enqueueRefreshForActiveMatches(repositories, requestHash);
      return {
        player: await this.toPlayer(repositories, result.player),
        alias: this.toUsername(result.username),
      };
    });
  }

  public async removeAlias(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    username: string,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "DELETE",
      path: `/players/aliases/${username}`,
    }, 200, async (repositories) => {
      const removed = await repositories.players.deleteUnconfirmedAlias(username);
      if (!removed) throw new NotFoundRepositoryError("Username alias was not found");
      return { username, removed: true, confirmationState: "unconfirmed" };
    });
  }

  public async updatePlayer(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    playerId: bigint,
    input: UpdatePlayerDto,
  ): Promise<Record<string, unknown>> {
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "PATCH",
      path: `/players/${playerId.toString(10)}`,
      body: input,
    }, 200, async (repositories, requestHash) => {
      const player = await repositories.players.updateDisplayNameInTransaction(playerId, input.displayName);
      await this.enqueueRefreshForActiveMatches(repositories, requestHash);
      return { player: await this.toPlayer(repositories, player) };
    });
  }

  private async transitionMatch(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    ifMatchHeader: string | undefined,
    matchId: bigint,
    to: "confirmed" | "completed" | "cancelled",
    cancellationReason?: string,
  ): Promise<Record<string, unknown>> {
    const expectedVersion = parseIfMatch(ifMatchHeader, false);
    return this.mutate(ownerTelegramUserId, idempotencyKey, {
      method: "POST",
      path: `/matches/${matchId.toString(10)}/${to}`,
      ...(to === "cancelled" ? { body: { cancellationReason } } : {}),
      ifMatch: expectedVersion,
    }, 200, async (repositories, requestHash) => {
      const current = await this.getLockedConfiguredMatch(repositories, matchId);
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new OptimisticConcurrencyError(expectedVersion, current.version);
      }
      if (to === "confirmed") {
        if (current.status !== "active") {
          throw evaluateMatchTransition({ from: current.status, to });
        }
        const counts = await repositories.votes.rosterCounts(matchId);
        const planningStage = deriveMatchPlanningStage(toDomainMatch(current), counts.goingCount);
        if (planningStage !== "ready_to_confirm") {
          throw restRequestError(
            409,
            "MATCH_NOT_READY_FOR_CONFIRMATION",
            "Select the time, reach the player threshold, and specify the venue before confirmation.",
            { planningStage },
          );
        }
      }
      const next = await repositories.matches.transitionStatus(matchId, {
        to,
        ...(cancellationReason === undefined ? {} : { cancellationReason }),
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      });
      if (to === "confirmed") await this.enqueueRefreshForMatch(repositories, next, requestHash);
      if (to === "completed" || to === "cancelled") await this.enqueueDeleteForMatch(repositories, next);
      const notification = await claimLifecycleNotificationEvent(
        repositories,
        next,
        this.config.telegramChatTopicId,
        this.config.groupTimezone,
        current.status,
      );
      if (notification !== undefined) await repositories.outbox.insertInTransaction(notification);
      return {
        match: this.toDetails(await this.loadAggregate(repositories, matchId)),
        action: {
          type: to === "confirmed" ? "match_confirmed" : to === "completed" ? "match_completed" : "match_cancelled",
          outboxState: "pending",
        },
      };
    });
  }

  private normalizeCreateInput(input: MatchCreateDto) {
    return assertValidCreateMatchInput({
      date: input.date,
      time: input.time,
      timeMode: input.timeMode ?? "exact",
      timeOptions: input.timeOptions ?? [],
      location: input.location,
      venueType: input.venueType ?? null,
      requiredPlayers: input.requiredPlayers,
      ...(input.fieldPriceRubles === undefined ? {} : { fieldPriceRubles: input.fieldPriceRubles }),
      ...(input.dateLabel === undefined ? {} : { dateLabel: input.dateLabel }),
      ...(input.timeLabel === undefined ? {} : { timeLabel: input.timeLabel }),
    });
  }

  private scheduledAt(date: string, time: string | null): Date | null {
    if (time === null) return null;
    try {
      return parseLocalDateTime(date, time, this.config.groupTimezone);
    } catch {
      throw restRequestError(400, "INVALID_LOCAL_DATETIME", "The requested local date and time do not exist in the configured timezone.");
    }
  }

  private localTime(scheduledAt: Date | null): string | null {
    if (scheduledAt === null) return null;
    const parts = getZonedDateParts(scheduledAt, this.config.groupTimezone);
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  }

  private patchValues(current: DbMatch, input: PatchMatchDto): {
    readonly scheduledAt?: Date | null;
    readonly scheduleDate?: string | null;
    readonly timeMode?: MatchTimeMode;
    readonly timeOptions?: readonly string[];
    readonly selectedTime?: string | null;
    readonly location?: string | null;
    readonly venueType?: "outdoor" | "indoor" | null;
    readonly fieldPriceRubles?: number | null;
    readonly requiredPlayers?: number;
    readonly title?: string | null;
  } {
    const datePresent = hasOwn(input, "date");
    const timePresent = hasOwn(input, "time");
    const timeModePresent = hasOwn(input, "timeMode");
    const timeOptionsPresent = hasOwn(input, "timeOptions");
    if (datePresent !== timePresent) {
      throw restRequestError(400, "SCHEDULE_FIELDS_REQUIRED", "date and time must be supplied together when changing a schedule.");
    }
    if ((timeModePresent || timeOptionsPresent) && (!datePresent || !timePresent)) {
      throw restRequestError(400, "SCHEDULE_FIELDS_REQUIRED", "date and time must be supplied when changing the time mode.");
    }
    const values: {
      scheduledAt?: Date | null;
      scheduleDate?: string | null;
      timeMode?: MatchTimeMode;
      timeOptions?: readonly string[];
      selectedTime?: string | null;
      location?: string | null;
      venueType?: "outdoor" | "indoor" | null;
      fieldPriceRubles?: number | null;
      requiredPlayers?: number;
      title?: string | null;
    } = {};
    if (datePresent && timePresent) {
      if (input.date === null || input.date === undefined) {
        throw restRequestError(400, "SCHEDULE_FIELDS_INVALID", "date must be a valid calendar date.");
      }
      const nextMode = input.timeMode ?? current.timeMode;
      if (nextMode !== "exact") {
        if (input.time !== null) throw restRequestError(400, "SCHEDULE_FIELDS_INVALID", "time must be null in time-option modes.");
        const options = input.timeOptions ?? current.timeOptions;
        if (options.length < 1) throw restRequestError(400, "TIME_OPTIONS_REQUIRED", "At least one availability time is required.");
        const preservedSelectedTime = current.timeMode === nextMode
          && current.selectedTime !== null
          && options.includes(current.selectedTime)
          ? current.selectedTime
          : null;
        const preservedFinalTime = this.localTime(current.scheduledAt) ?? preservedSelectedTime;
        values.scheduledAt = preservedSelectedTime === null ? null : this.scheduledAt(input.date, preservedFinalTime);
        values.scheduleDate = input.date;
        values.timeMode = nextMode;
        values.timeOptions = options;
        values.selectedTime = preservedSelectedTime;
      } else {
        if (input.time === null || input.time === undefined) throw restRequestError(400, "SCHEDULE_FIELDS_INVALID", "time is required in exact mode.");
        values.scheduledAt = this.scheduledAt(input.date, input.time);
        values.scheduleDate = input.date;
        values.timeMode = nextMode;
        values.timeOptions = [];
        values.selectedTime = null;
      }
    }
    if (hasOwn(input, "location")) values.location = input.location ?? null;
    if (hasOwn(input, "venueType")) values.venueType = input.venueType ?? null;
    if (hasOwn(input, "fieldPriceRubles")) values.fieldPriceRubles = input.fieldPriceRubles ?? null;
    if (hasOwn(input, "requiredPlayers")) {
      if (input.requiredPlayers === undefined) {
        throw restRequestError(400, "REQUIRED_PLAYERS_INVALID", "requiredPlayers must be an integer.");
      }
      values.requiredPlayers = input.requiredPlayers;
    }
    if (Object.keys(values).length === 0) {
      throw restRequestError(400, "MATCH_UPDATE_EMPTY", "At least one editable match field is required.");
    }
    const titleChanged = datePresent || hasOwn(input, "location") || hasOwn(input, "fieldPriceRubles");
    if (titleChanged) {
      const scheduleDate = values.scheduleDate ?? current.scheduleDate;
      const timeMode = values.timeMode ?? current.timeMode;
      if (scheduleDate !== null) {
        const scheduledAt = values.scheduledAt === undefined ? current.scheduledAt : values.scheduledAt;
        const time = this.localTime(scheduledAt);
        values.title = formatDerivedTitle({
          date: scheduleDate,
          time,
          timeMode,
          location: values.location === undefined ? current.location : values.location,
          fieldPriceRubles: values.fieldPriceRubles === undefined ? current.fieldPriceRubles : values.fieldPriceRubles,
        });
      } else {
        values.title = current.title;
      }
    }
    return values;
  }

  private async loadAggregate(repositories: RestRepositories, matchId: bigint): Promise<MatchAggregate> {
    const match = await repositories.matches.getById(matchId);
    this.assertConfiguredMatch(match);
    const message = await repositories.matchMessages.findByMatchId(matchId);
    const votes = await repositories.votes.listByMatchId(matchId);
    const externalParticipants = await repositories.externalParticipants.listByMatchId(matchId);
    const counts = await repositories.votes.rosterCounts(matchId);
    const playerIds = [...new Set(votes.map((vote) => vote.playerId))];
    const players = await Promise.all(playerIds.map(async (playerId) => repositories.players.getById(playerId)));
    const currentReadableNames = new Map(players.map((player) => [player.id, player.displayName] as const));
    const currentPlayers = new Map(players.map((player) => [player.id, player] as const));
    return { match, message, votes, externalParticipants, counts, currentReadableNames, currentPlayers };
  }

  private async getLockedConfiguredMatch(repositories: RestRepositories, matchId: bigint): Promise<DbMatch> {
    const match = await repositories.matches.getForUpdate(matchId);
    this.assertConfiguredMatch(match);
    return match;
  }

  private assertConfiguredMatch(match: DbMatch): void {
    if (match.telegramChatId !== this.config.telegramGroupChatId) {
      throw new NotFoundRepositoryError("Match was not found");
    }
  }

  private renderAggregate(aggregate: MatchAggregate): { readonly text: string; readonly isActive: boolean } {
    return renderMatchCard({
      match: toDomainMatch(aggregate.match),
      votes: aggregate.votes.map((vote) => ({
        ...toDomainVote(vote),
        displayNameSnapshot: aggregate.currentReadableNames.get(vote.playerId) ?? vote.displayNameSnapshot,
      })),
      externalParticipants: aggregate.externalParticipants.map(toDomainExternalParticipant),
    }, { timezone: this.config.groupTimezone });
  }

  private toDetails(aggregate: MatchAggregate): MatchDetailsBody {
    const match = toDomainMatch(aggregate.match);
    const schedule = aggregate.match.scheduleDate === null && aggregate.match.scheduledAt === null
      ? { date: null, time: null, timezone: this.config.groupTimezone }
      : (() => {
        const parts = aggregate.match.scheduledAt === null
          ? undefined
          : getZonedDateParts(aggregate.match.scheduledAt, this.config.groupTimezone);
        return {
          date: aggregate.match.scheduleDate ?? (parts === undefined ? null : `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`),
          time: parts === undefined ? null : `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
          timezone: this.config.groupTimezone,
        };
      })();
    const state = aggregate.message?.publicationState ?? "not_published";
    const reconciliationState = state === "pending" || state === "uncertain" || state === "failed" ? state : "none";
    return serializeRestObject({
      id: aggregate.match.id,
      chatId: aggregate.match.telegramChatId,
      scheduledAt: aggregate.match.scheduledAt,
      timeMode: aggregate.match.timeMode,
      timeOptions: aggregate.match.timeOptions,
      selectedTime: aggregate.match.selectedTime,
      schedule,
      location: aggregate.match.location,
      venueType: aggregate.match.venueType,
      fieldPriceRubles: aggregate.match.fieldPriceRubles,
      title: aggregate.match.title,
      displayTitle: formatMatchCardTitle(match, { timezone: this.config.groupTimezone }),
      requiredPlayers: aggregate.match.requiredPlayers,
      status: aggregate.match.status,
      planningStage: deriveMatchPlanningStage(match, aggregate.counts.goingCount),
      version: aggregate.match.version,
      cancellationReason: aggregate.match.cancellationReason,
      creatorTelegramUserId: aggregate.match.creatorTelegramUserId,
      createdAt: aggregate.match.createdAt,
      updatedAt: aggregate.match.updatedAt,
      roster: {
        counts: aggregate.counts,
        votes: aggregate.votes.map((vote) => ({
          playerId: vote.playerId,
          telegramUserId: vote.telegramUserId,
          username: vote.usernameSnapshot,
          readableName: aggregate.currentReadableNames.get(vote.playerId) ?? vote.displayNameSnapshot,
          avatarUrl: playerAvatarUrl(aggregate.currentPlayers.get(vote.playerId)),
          option: vote.option,
          availableAfter: vote.availableAfter,
          exactTimes: vote.exactTimes,
          source: vote.source,
          updatedAt: vote.updatedAt,
        })),
        externalParticipants: aggregate.externalParticipants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          availableAfter: participant.availableAfter,
          quantity: participant.quantity,
          createdByTelegramUserId: participant.createdByTelegramUserId,
          sourceUpdateId: participant.sourceUpdateId,
          createdAt: participant.createdAt,
          updatedAt: participant.updatedAt,
        })),
      },
      publicCard: {
        publicationState: state,
        reconciliationState,
        reconciliationRequired: state === "uncertain" || state === "failed",
        telegramChatId: aggregate.message?.telegramChatId ?? null,
        telegramTopicId: aggregate.message?.telegramTopicId ?? null,
        telegramMessageId: aggregate.message?.telegramMessageId ?? null,
        publicationAttemptedAt: aggregate.message?.publicationAttemptedAt ?? null,
        publicationUncertainAt: aggregate.message?.publicationUncertainAt ?? null,
      },
    }) as unknown as MatchDetailsBody;
  }

  private toSummary(aggregate: MatchAggregate): Record<string, unknown> {
    return this.toDetails(aggregate);
  }

  private groupSummaries(summaries: readonly Record<string, unknown>[]): Record<string, unknown> {
    return {
      drafts: summaries.filter((summary) => summary["status"] === "draft"),
      active: summaries.filter((summary) => summary["status"] === "active"),
      confirmed: summaries.filter((summary) => summary["status"] === "confirmed"),
      history: summaries.filter((summary) => summary["status"] === "completed" || summary["status"] === "cancelled"),
    };
  }

  private async enqueueCardEvent(
    repositories: RestRepositories,
    match: DbMatch,
    eventType: "publish_public_card" | "refresh_public_card" | "reconcile_public_card",
    deduplicationKey: string,
    card: { readonly text: string; readonly isActive: boolean },
  ): Promise<void> {
    await repositories.outbox.insertInTransaction({
      eventType,
      deduplicationKey,
      matchId: match.id,
      telegramChatId: match.telegramChatId,
      telegramTopicId: publicCardTopicId(this.config),
      payload: {
        text: card.text,
        isActive: card.isActive,
        matchVersion: match.version,
      },
    });
  }

  private async enqueueRefreshForMatch(
    repositories: RestRepositories,
    match: DbMatch,
    requestHash: string,
  ): Promise<"refresh_public_card" | undefined> {
    const aggregate = await this.loadAggregate(repositories, match.id);
    if (aggregate.message?.publicationState !== "published") return undefined;
    const eventType = "refresh_public_card" as const;
    await this.enqueueCardEvent(
      repositories,
      match,
      eventType,
      `${eventType}:${match.id.toString(10)}:${requestHash}`,
      this.renderAggregate(aggregate),
    );
    return eventType;
  }

  private async enqueueThresholdNotification(
    repositories: TransactionRepositories,
    result: Parameters<typeof claimThresholdNotificationEvent>[1],
    operationKey: string,
  ): Promise<void> {
    const notification = await claimThresholdNotificationEvent(
      repositories,
      result,
      operationKey,
      this.config.telegramChatTopicId,
    );
    if (notification !== undefined) await repositories.outbox.insertInTransaction(notification);
  }

  private async enqueueDeleteForMatch(repositories: RestRepositories, match: DbMatch): Promise<void> {
    const message = await repositories.matchMessages.findByMatchId(match.id);
    if (message === undefined) return;
    await repositories.outbox.insertInTransaction({
      eventType: "delete_public_card",
      deduplicationKey: `delete:public-card:${match.id.toString(10)}:v${match.version}`,
      matchId: match.id,
      telegramChatId: match.telegramChatId,
      telegramTopicId: publicCardTopicId(this.config),
      payload: { matchVersion: match.version, status: match.status },
    });
  }

  private async enqueueRefreshForActiveMatches(
    repositories: RestRepositories,
    requestHash: string,
  ): Promise<void> {
    const matches = await repositories.matches.list({
      telegramChatId: this.config.telegramGroupChatId,
      statuses: ["active", "confirmed"],
    });
    for (const match of matches) await this.enqueueRefreshForMatch(repositories, match, requestHash);
  }

  private async toPlayer(repositories: RestRepositories, player: DbPlayer): Promise<PlayerBody> {
    const usernames = await repositories.playerUsernames.findByPlayerId(player.id);
    return serializeRestObject({
      id: player.id,
      telegramUserId: player.telegramUserId,
      displayName: player.displayName,
      avatarUrl: playerAvatarUrl(player),
      confirmed: player.telegramUserId !== null,
      confirmationState: player.telegramUserId === null ? "unconfirmed" : "confirmed",
      telegramUsernameSnapshot: player.telegramUsernameSnapshot,
      telegramFirstNameSnapshot: player.telegramFirstNameSnapshot,
      telegramLastNameSnapshot: player.telegramLastNameSnapshot,
      telegramLanguageCode: player.telegramLanguageCode,
      usernames: usernames.map((alias: DbPlayerUsername) => this.toUsername(alias)),
    }) as unknown as PlayerBody;
  }

  private toUsername(alias: DbPlayerUsername): Record<string, unknown> {
    return {
      normalizedUsername: alias.normalizedUsername,
      username: `@${alias.normalizedUsername}`,
      playerId: alias.playerId,
      lastSeenAt: alias.lastSeenAt,
      createdAt: alias.createdAt,
      updatedAt: alias.updatedAt,
    };
  }

  private async read<T extends Record<string, unknown>>(
    ownerTelegramUserId: bigint,
    callback: () => Promise<T>,
  ): Promise<T> {
    this.assertOwner(ownerTelegramUserId);
    try {
      return serializeRestObject(await callback()) as T;
    } catch (error) {
      throw toRestHttpException(error);
    }
  }

  private async mutate(
    ownerTelegramUserId: bigint,
    idempotencyKey: string | undefined,
    request: unknown,
    successStatus: number,
    callback: (
      repositories: TransactionRepositories,
      requestHash: string,
      operationKey: string,
    ) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    this.assertOwner(ownerTelegramUserId);
    const key = idempotencyKey?.trim();
    if (key === undefined || key === "") {
      throw toRestHttpException(restRequestError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for mutations."));
    }
    const requestHash = canonicalRequestHash(request);
    const operationKey = `owner-mutation:${canonicalRequestHash({ idempotencyKey: key })}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
    const beginInput = {
      ownerTelegramUserId,
      idempotencyKey: key,
      requestHash,
      expiresAt,
      now,
    };
    let started = false;
    let outcome: IdempotencyReplay | IdempotencyInProgress | IdempotencySuccess;
    try {
      outcome = await withTransaction(this.db, async (repositories) => {
        const begin = await repositories.idempotency.beginInTransaction(beginInput);
        if (begin.status === "replay") {
          return {
            kind: "replay" as const,
            status: begin.record.responseStatus ?? 409,
            body: begin.record.responseBody,
          };
        }
        if (begin.status === "in_progress") return { kind: "in_progress" as const };
        started = true;
        const body = serializeRestObject(await callback(repositories, requestHash, operationKey));
        await repositories.idempotency.complete(begin.record.id, { status: successStatus, body });
        return { kind: "success" as const, body };
      });
    } catch (error) {
      const mapped = mapRestError(error);
      if (started) {
        try {
          await withTransaction(this.db, async (repositories) => {
            const begin = await repositories.idempotency.beginInTransaction({
              ...beginInput,
              now: new Date(),
              expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
            });
            if (begin.status === "started") {
              await repositories.idempotency.fail(begin.record.id, {
                status: mapped.status,
                body: { ...mapped.body },
              });
            }
          });
        } catch {
          // Preserve the original stable application error if failure persistence races.
        }
      }
      throw toRestHttpException(error);
    }
    if (outcome.kind === "in_progress") {
      throw toRestHttpException(restRequestError(409, "IDEMPOTENCY_IN_PROGRESS", "The same mutation is already being processed."));
    }
    if (outcome.kind === "replay") {
      if (outcome.body === null) {
        throw toRestHttpException(restRequestError(409, "IDEMPOTENCY_RESPONSE_MISSING", "The stored mutation response is unavailable."));
      }
      if (outcome.status >= 400) throw new HttpException(outcome.body, outcome.status);
      return outcome.body;
    }
    await this.dispatchOneOutboxEventBestEffort();
    return outcome.body;
  }

  private async dispatchOneOutboxEventBestEffort(): Promise<void> {
    if (this.outboxBestEffort === undefined) return;
    try {
      await this.outboxBestEffort.dispatch();
    } catch {
      // Cron remains the durable recovery path when the bounded post-commit attempt fails.
    }
  }

  private assertOwner(ownerTelegramUserId: bigint): void {
    if (ownerTelegramUserId !== this.config.telegramOwnerUserId) {
      throw toRestHttpException(restRequestError(403, "TELEGRAM_OWNER_REQUIRED", "This API is restricted to the configured owner."));
    }
  }
}
