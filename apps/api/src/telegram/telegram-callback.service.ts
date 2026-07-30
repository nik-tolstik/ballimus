import { Inject, Injectable } from "@nestjs/common";
import type { Context } from "grammy";
import type {
  AppDatabase,
  AtomicVoteChangeOptions,
  EventFactory,
  InsertOutboxEventInput,
  TelegramVoteInput,
  TelegramVoteResult,
} from "@football/db";
import { runVoteChangeTransaction } from "@football/db";

import { APP_DATABASE } from "../database/database.constants.js";
import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { claimThresholdNotificationEvent } from "../notifications/notification-events.js";
import {
  callbackSourceFromQuery,
  parseTelegramCallbackPayload,
  type TelegramCallbackPayload,
  type TelegramCallbackSource,
} from "./callback-payload.js";
import {
  TelegramCardService,
  type TelegramCardSourceValidation,
} from "./telegram-card.service.js";
import { TelegramEffects } from "./telegram-effects.js";
import { OutboxBestEffortService } from "./outbox-best-effort.service.js";
import { TelegramAvatarService } from "./telegram-avatar.service.js";

export interface TelegramCallbackEffectsPort {
  answerCallbackQuery: TelegramEffects["answerCallbackQuery"];
}

export interface TelegramCallbackCardPort {
  validateVoteSource: (
    matchId: bigint,
    source: TelegramCallbackSource,
  ) => Promise<TelegramCardSourceValidation>;
  refreshPublicCard: TelegramCardService["refreshPublicCard"];
}

export type TelegramVoteTransactionRunner = typeof runVoteChangeTransaction;

export interface TelegramCallbackDependencies {
  readonly database: AppDatabase;
  readonly apiConfig: ApiConfig;
  readonly effects: TelegramCallbackEffectsPort;
  readonly cards: TelegramCallbackCardPort;
  readonly runVoteChangeTransaction: TelegramVoteTransactionRunner;
  readonly dispatchOutboxBestEffort?: () => Promise<unknown>;
  readonly refreshPlayerAvatar?: (telegramUserId: bigint) => Promise<unknown>;
}

export type TelegramCallbackProcessResult =
  | { readonly status: "ignored"; readonly reason: string }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "duplicate"; readonly updateId: bigint }
  | { readonly status: "inactive"; readonly updateId: bigint }
  | { readonly status: "applied"; readonly updateId: bigint; readonly matchId: bigint };

function safeUpdateId(value: unknown): bigint | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return BigInt(value);
}

function safeUserId(value: unknown): bigint | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return undefined;
  return BigInt(value);
}

function displayNameForUser(user: {
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly id: number;
}): string {
  const name = [user.first_name, user.last_name]
    .filter((part): part is string => part !== undefined && part.trim() !== "")
    .join(" ")
    .trim();
  if (name !== "") return name;
  if (user.username?.trim() !== undefined && user.username.trim() !== "") return `@${user.username.trim()}`;
  return `Telegram user ${user.id.toString(10)}`;
}

function callbackAnswerText(result: TelegramVoteResult): string {
  switch (result.status) {
    case "duplicate":
      return "Это действие уже обработано";
    case "inactive":
      return "Матч больше не принимает голоса";
    case "applied":
      return "Голос сохранён";
  }
}

async function answerSafely(
  effects: TelegramCallbackEffectsPort,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  try {
    await effects.answerCallbackQuery(callbackQueryId, { text });
  } catch {
    // Callback acknowledgement failures must not cause the business update to replay.
  }
}

function refreshEventFactory(
  payload: TelegramCallbackPayload,
  updateId: bigint,
  apiConfig: ApiConfig,
): EventFactory<TelegramVoteResult> {
  return async (result, repositories): Promise<readonly InsertOutboxEventInput[]> => {
    if (result.status !== "applied" || payload.kind !== "vote") return [];
    const notification = await claimThresholdNotificationEvent(
      repositories,
      result,
      `telegram-update:${updateId.toString(10)}`,
      apiConfig.telegramChatTopicId,
    );
    return [{
      eventType: "refresh_public_card",
      deduplicationKey: `telegram:refresh:${payload.matchId.toString(10)}:${updateId.toString(10)}`,
      matchId: payload.matchId,
      telegramChatId: apiConfig.telegramGroupChatId,
      telegramTopicId: apiConfig.telegramGeneralTopicId,
      payload: {
        source: "telegram_callback",
        updateId: updateId.toString(10),
      },
    }, ...(notification === undefined ? [] : [notification])];
  };
}

/** Handles callback queries without exposing grammY context to the persistence layer. */
export async function processTelegramCallback(
  context: Context,
  dependencies: TelegramCallbackDependencies,
): Promise<TelegramCallbackProcessResult> {
  const query = context.callbackQuery;
  if (query === undefined) return { status: "ignored", reason: "not a callback query" };

  const payload = parseTelegramCallbackPayload(query.data);
  if (payload === undefined) {
    await answerSafely(dependencies.effects, query.id, "Недопустимое действие");
    return { status: "invalid", reason: "callback payload is malformed or unknown" };
  }
  if (payload.kind === "owner") {
    await answerSafely(dependencies.effects, query.id, "Это действие пока недоступно");
    return { status: "unsupported", reason: "owner callback actions are not enabled" };
  }

  const source = callbackSourceFromQuery(query);
  if (source === undefined) {
    await answerSafely(dependencies.effects, query.id, "Источник действия недействителен");
    return { status: "invalid", reason: "callback source is missing or inline" };
  }
  const sourceValidation = await dependencies.cards.validateVoteSource(payload.matchId, source);
  if (sourceValidation.status !== "accepted") {
    await answerSafely(dependencies.effects, query.id, "Это сообщение матча больше не актуально");
    return { status: "ignored", reason: sourceValidation.reason };
  }

  const updateId = safeUpdateId(context.update.update_id);
  const telegramUserId = safeUserId(query.from.id);
  if (updateId === undefined || telegramUserId === undefined) {
    await answerSafely(dependencies.effects, query.id, "Идентификатор действия недействителен");
    return { status: "invalid", reason: "Telegram identifiers are invalid" };
  }

  const identity: TelegramVoteInput["identity"] = {
    telegramUserId,
    username: query.from.username ?? null,
    firstName: query.from.first_name,
    lastName: query.from.last_name ?? null,
    languageCode: query.from.language_code ?? null,
    displayName: displayNameForUser(query.from),
    seenAt: new Date(),
  };
  const transactionOptions: AtomicVoteChangeOptions = {
    outbox: refreshEventFactory(payload, updateId, dependencies.apiConfig),
  };
  const result = await dependencies.runVoteChangeTransaction(
    dependencies.database,
    {
      updateId,
      matchId: payload.matchId,
      identity,
      option: payload.option,
      ...(payload.availableAfter === undefined ? {} : { availableAfter: payload.availableAfter }),
    },
    transactionOptions,
  );

  await answerSafely(dependencies.effects, query.id, callbackAnswerText(result));
  if (result.status === "applied") {
    if (dependencies.dispatchOutboxBestEffort === undefined) {
      try {
        await dependencies.cards.refreshPublicCard(result.match.id);
      } catch {
        // The durable refresh outbox event remains the recovery path for a failed edit.
      }
    } else {
      try {
        await dependencies.dispatchOutboxBestEffort();
      } catch {
        // Cron remains the durable recovery path for failed post-commit delivery.
      }
    }
    if (dependencies.refreshPlayerAvatar !== undefined) {
      try {
        await dependencies.refreshPlayerAvatar(telegramUserId);
      } catch {
        // Avatar caching is best-effort and must never roll back or replay a committed vote.
      }
    }
    return { status: "applied", updateId, matchId: result.match.id };
  }
  if (result.status === "duplicate") return { status: "duplicate", updateId: result.updateId };
  return { status: "inactive", updateId: result.updateId };
}

@Injectable()
export class TelegramCallbackService {
  public constructor(
    @Inject(APP_DATABASE) private readonly database: AppDatabase,
    @Inject(API_CONFIG) private readonly apiConfig: ApiConfig,
    @Inject(TelegramEffects) private readonly effects: TelegramEffects,
    @Inject(TelegramCardService) private readonly cards: TelegramCardService,
    @Inject(OutboxBestEffortService) private readonly outboxBestEffort: OutboxBestEffortService,
    @Inject(TelegramAvatarService) private readonly avatars: TelegramAvatarService,
  ) {}

  public handle(context: Context): Promise<TelegramCallbackProcessResult> {
    return processTelegramCallback(context, {
      database: this.database,
      apiConfig: this.apiConfig,
      effects: this.effects,
      cards: this.cards,
      runVoteChangeTransaction,
      dispatchOutboxBestEffort: () => this.outboxBestEffort.dispatch(),
      refreshPlayerAvatar: (telegramUserId) => this.avatars.refreshIfStale(telegramUserId),
    });
  }
}
