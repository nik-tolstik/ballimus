import { readFile } from "node:fs/promises";

import { UnauthorizedException } from "@nestjs/common";
import type {
  AppDatabase,
  Match as DatabaseMatch,
  MatchMessage,
  TelegramVoteResult,
  TransactionRepositories,
} from "@football/db";
import { describe, expect, it, vi } from "vitest";
import { Bot, GrammyError, type Context } from "grammy";

import type { ApiConfig } from "../config/api-config.js";
import {
  processTelegramCallback,
  type TelegramCallbackDependencies,
  type TelegramVoteTransactionRunner,
} from "./telegram-callback.service.js";
import {
  publicCardKeyboard,
  publicCardSendOptions,
  validatePublicCardSource,
} from "./telegram-card.service.js";
import { parseTelegramCallbackPayload } from "./callback-payload.js";
import {
  handleInitializedTelegramUpdate,
  TelegramBotService,
} from "./telegram-effects.js";
import {
  TelegramWebhookController,
  parseTelegramUpdateBody,
  timingSafeTelegramSecretEquals,
} from "./telegram-webhook.controller.js";

const apiConfig = {
  databaseUrl: "postgresql://localhost/football",
  telegramBotToken: "test-token",
  telegramWebhookSecret: "webhook-secret",
  telegramOwnerUserId: 7n,
  telegramGroupChatId: -100123n,
  telegramGeneralTopicId: 1n,
  telegramChatTopicId: 42n,
  telegramMiniAppUrl: "https://mini.example.test",
  webOrigin: "https://web.example.test",
  groupTimezone: "Europe/Minsk",
  logLevel: "info",
  port: 6000,
  miniAppInitDataMaxAgeSeconds: 86_400,
} as ApiConfig;

const database = {} as AppDatabase;

const match = {
  id: 32n,
  telegramChatId: apiConfig.telegramGroupChatId,
  scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
  location: "Ракета",
  venueType: "outdoor",
  fieldPriceRubles: 100,
  title: "Матч",
  requiredPlayers: 3,
  status: "active",
  cancellationReason: null,
  creatorTelegramUserId: apiConfig.telegramOwnerUserId,
  version: 1,
  createdAt: new Date("2026-07-29T00:00:00.000Z"),
  updatedAt: new Date("2026-07-29T00:00:00.000Z"),
} as DatabaseMatch;

function appliedResult(): TelegramVoteResult {
  const counts = {
    goingVotes: 1,
    externalParticipants: 0,
    goingCount: 1,
    requiredPlayers: 3,
    thresholdReached: false,
    remainingToThreshold: 2,
  };
  return {
    status: "applied",
    match,
    playerId: 100n,
    countsBefore: counts,
    countsAfter: counts,
    thresholdReached: false,
    thresholdLost: false,
  };
}

function callbackContext(
  data: string | undefined,
  updateId = 900,
  messageThreadId?: number,
): Context {
  const query = {
    id: "callback-1",
    from: {
      id: 55,
      is_bot: false,
      first_name: "Игрок",
      username: "player_one",
    },
    message: {
      message_id: 701,
      date: 1,
      chat: { id: Number(apiConfig.telegramGroupChatId), type: "supergroup" },
      ...(messageThreadId === undefined ? {} : { message_thread_id: messageThreadId }),
    },
    chat_instance: "chat-instance",
    ...(data === undefined ? {} : { data }),
  };
  return {
    update: {
      update_id: updateId,
      callback_query: query,
    },
    callbackQuery: query,
  } as unknown as Context;
}

function dependencies(
  result: TelegramVoteResult = appliedResult(),
): TelegramCallbackDependencies & {
  readonly answerCallbackQuery: ReturnType<typeof vi.fn>;
  readonly validateVoteSource: ReturnType<typeof vi.fn>;
  readonly refreshPublicCard: ReturnType<typeof vi.fn>;
  readonly runVote: ReturnType<typeof vi.fn>;
} {
  const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
  const validateVoteSource = vi.fn().mockResolvedValue({
    status: "accepted",
    reference: { publicationState: "published" },
  });
  const refreshPublicCard = vi.fn().mockResolvedValue({ status: "refreshed" });
  const runVote = vi.fn(async () => result) as unknown as ReturnType<typeof vi.fn>;
  return {
    database,
    apiConfig,
    effects: { answerCallbackQuery },
    cards: { validateVoteSource, refreshPublicCard },
    runVoteChangeTransaction: runVote as unknown as TelegramVoteTransactionRunner,
    answerCallbackQuery,
    validateVoteSource,
    refreshPublicCard,
    runVote,
  };
}

describe("Telegram webhook security", () => {
  it("initializes grammY before dispatching a webhook update", async () => {
    const calls: string[] = [];
    let initialized = false;
    const init = vi.fn(async () => {
      calls.push("init");
      initialized = true;
    });
    const handleUpdate = vi.fn(async () => {
      calls.push("handle");
    });
    const bot = {
      isInited: () => initialized,
      init,
      handleUpdate,
    } as unknown as Pick<Bot, "handleUpdate" | "init" | "isInited">;
    const update = { update_id: 1, callback_query: {} };

    await handleInitializedTelegramUpdate(bot, update as never);
    await handleInitializedTelegramUpdate(bot, update as never);

    expect(calls).toEqual(["init", "handle", "handle"]);
    expect(init).toHaveBeenCalledOnce();
    expect(handleUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects missing and wrong secrets without dispatching", async () => {
    const handleUpdate = vi.fn().mockResolvedValue(undefined);
    const controller = new TelegramWebhookController(
      { handleUpdate } as unknown as TelegramBotService,
      apiConfig,
    );
    const update = { update_id: 1, callback_query: {} };

    await expect(controller.receiveWebhook(undefined, update)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.receiveWebhook("wrong", update)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("uses the timing-safe comparison and dispatches only after a valid secret", async () => {
    expect(timingSafeTelegramSecretEquals("webhook-secret", apiConfig.telegramWebhookSecret)).toBe(true);
    expect(timingSafeTelegramSecretEquals("webhook-secre", apiConfig.telegramWebhookSecret)).toBe(false);
    expect(timingSafeTelegramSecretEquals("webhook-secret-extra", apiConfig.telegramWebhookSecret)).toBe(false);

    const handleUpdate = vi.fn().mockResolvedValue(undefined);
    const controller = new TelegramWebhookController(
      { handleUpdate } as unknown as TelegramBotService,
      apiConfig,
    );
    const update = { update_id: 2 };
    await controller.receiveWebhook(apiConfig.telegramWebhookSecret, update);
    expect(handleUpdate).toHaveBeenCalledWith(update);
  });

  it("rejects malformed envelopes without exposing the body", () => {
    expect(() => parseTelegramUpdateBody({ callback_query: {} })).toThrow("Telegram update is malformed");
    expect(() => parseTelegramUpdateBody({ update_id: 1, callback_query: "bad" })).toThrow("Telegram callback query is malformed");
  });
});

describe("Telegram API effects", () => {
  it("treats an unchanged message edit as an idempotent success", async () => {
    const service = new TelegramBotService(apiConfig);
    const editMessageText = vi.fn().mockRejectedValue(
      new GrammyError(
        "Call to 'editMessageText' failed!",
        {
          ok: false,
          error_code: 400,
          description:
            "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
        },
        "editMessageText",
        {},
      ),
    );
    Object.assign(service, { bot: { api: { editMessageText } } });

    await expect(
      service.editMessageText({ chatId: -100123n, messageId: 701n, text: "Same card" }),
    ).resolves.toBeUndefined();
    expect(editMessageText).toHaveBeenCalledOnce();
  });

  it("rethrows other Telegram edit failures", async () => {
    const service = new TelegramBotService(apiConfig);
    const error = new GrammyError(
      "Call to 'editMessageText' failed!",
      { ok: false, error_code: 400, description: "Bad Request: message to edit not found" },
      "editMessageText",
      {},
    );
    const editMessageText = vi.fn().mockRejectedValue(error);
    Object.assign(service, { bot: { api: { editMessageText } } });

    await expect(
      service.editMessageText({ chatId: -100123n, messageId: 701n, text: "New card" }),
    ).rejects.toBe(error);
  });
});

describe("Telegram callback processing", () => {
  it("parses vote and supported owner callback payloads as typed values", () => {
    expect(parseTelegramCallbackPayload("vote:32:going")).toEqual({
      kind: "vote",
      matchId: 32n,
      option: "going",
    });
    expect(parseTelegramCallbackPayload("vote:32:after_1930")).toEqual({
      kind: "vote",
      matchId: 32n,
      option: "going",
      availableAfter: "19:30",
    });
    expect(parseTelegramCallbackPayload("vote:32:at_2000")).toEqual({
      kind: "vote",
      matchId: 32n,
      option: "going",
      availableAfter: "20:00",
    });
    expect(parseTelegramCallbackPayload("match:32:confirm")).toEqual({
      kind: "owner",
      matchId: 32n,
      action: "confirm",
    });
    expect(parseTelegramCallbackPayload("match:32:unknown")).toBeUndefined();
  });

  it("renders distinct buttons for exact and after-time polls", () => {
    const exactKeyboard = publicCardKeyboard({
      ...match,
      scheduledAt: null,
      scheduleDate: "2026-08-03",
      timeMode: "exact_options",
      timeOptions: ["19:00", "20:00"],
      selectedTime: null,
    });
    const afterKeyboard = publicCardKeyboard({
      ...match,
      scheduledAt: null,
      scheduleDate: "2026-08-03",
      timeMode: "availability",
      timeOptions: ["19:00", "20:00"],
      selectedTime: null,
    });

    expect(exactKeyboard.inline_keyboard[0]).toEqual([
      { text: "19:00", callback_data: "vote:32:at_1900" },
      { text: "20:00", callback_data: "vote:32:at_2000" },
    ]);
    expect(afterKeyboard.inline_keyboard[0]).toEqual([
      { text: "После 19:00", callback_data: "vote:32:after_1900" },
      { text: "После 20:00", callback_data: "vote:32:after_2000" },
    ]);
  });

  it("requires the configured group, General topic, and stored published card", () => {
    const reference = {
      telegramChatId: apiConfig.telegramGroupChatId,
      telegramTopicId: 1n,
      telegramMessageId: 701n,
      publicationState: "published",
    } as unknown as MatchMessage;
    const source = { chatId: apiConfig.telegramGroupChatId, topicId: null, messageId: 701n };
    expect(validatePublicCardSource(source, reference, apiConfig).status).toBe("accepted");
    expect(validatePublicCardSource({ ...source, chatId: -999n }, reference, apiConfig).status).toBe("rejected");
    expect(validatePublicCardSource({ ...source, topicId: 42n }, reference, apiConfig).status).toBe("rejected");
    expect(validatePublicCardSource({ ...source, messageId: 702n }, reference, apiConfig).status).toBe("rejected");
    expect(validatePublicCardSource(source, undefined, apiConfig).status).toBe("rejected");
  });

  it("rejects malformed callback payloads without a database transaction", async () => {
    const deps = dependencies();
    const result = await processTelegramCallback(callbackContext("vote:32:unknown"), deps);

    expect(result.status).toBe("invalid");
    expect(deps.runVote).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it("treats a fake or out-of-scope source as a no-op", async () => {
    const deps = dependencies();
    deps.validateVoteSource.mockResolvedValue({
      status: "rejected",
      reason: "callback topic is outside General",
    });
    const result = await processTelegramCallback(callbackContext("vote:32:going", 901, 42), deps);

    expect(result.status).toBe("ignored");
    expect(deps.runVote).not.toHaveBeenCalled();
    expect(deps.refreshPublicCard).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it("does not reapply a duplicate update", async () => {
    const deps = dependencies({ status: "duplicate", updateId: 902n });
    const result = await processTelegramCallback(callbackContext("vote:32:going", 902), deps);

    expect(result).toEqual({ status: "duplicate", updateId: 902n });
    expect(deps.refreshPublicCard).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it("acknowledges only after the committed vote transaction", async () => {
    const events: string[] = [];
    const deps = dependencies();
    deps.runVote.mockImplementation(async () => {
      events.push("transaction");
      return appliedResult();
    });
    deps.answerCallbackQuery.mockImplementation(async () => {
      events.push("ack");
    });
    deps.refreshPublicCard.mockImplementation(async () => {
      events.push("refresh");
      return { status: "refreshed" };
    });

    const result = await processTelegramCallback(callbackContext("vote:32:going"), deps);

    expect(result).toEqual({ status: "applied", updateId: 900n, matchId: 32n });
    expect(events).toEqual(["transaction", "ack", "refresh"]);
    expect(deps.runVote).toHaveBeenCalledOnce();
  });

  it("acknowledges removal of the last exact-time choice and refreshes the card", async () => {
    const counts = {
      goingVotes: 0,
      externalParticipants: 0,
      goingCount: 0,
      requiredPlayers: 3,
      thresholdReached: false,
      remainingToThreshold: 3,
    };
    const removedResult: TelegramVoteResult = {
      status: "removed",
      match: { ...match, timeMode: "exact_options" } as DatabaseMatch,
      playerId: 100n,
      countsBefore: { ...counts, goingVotes: 1, goingCount: 1, remainingToThreshold: 2 },
      countsAfter: counts,
      thresholdReached: false,
      thresholdLost: false,
    };
    const deps = dependencies(removedResult);

    const result = await processTelegramCallback(callbackContext("vote:32:at_1900", 904), deps);

    expect(result).toEqual({ status: "applied", updateId: 904n, matchId: 32n });
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith("callback-1", { text: "Выбор времени снят" });
    expect(deps.refreshPublicCard).toHaveBeenCalledOnce();
  });

  it("adds a durable Chat-topic notification when a real vote crosses the threshold", async () => {
    const countsBefore = { goingVotes: 2, externalParticipants: 0, goingCount: 2, requiredPlayers: 3, thresholdReached: false, remainingToThreshold: 1 };
    const countsAfter = { goingVotes: 3, externalParticipants: 0, goingCount: 3, requiredPlayers: 3, thresholdReached: true, remainingToThreshold: 0 };
    const thresholdResult: TelegramVoteResult = {
      status: "applied",
      match,
      playerId: 100n,
      countsBefore,
      countsAfter,
      thresholdReached: true,
      thresholdLost: false,
    };
    const claimInTransaction = vi.fn().mockResolvedValue({
      status: "claimed",
      notification: { id: 77n },
    });
    const repositories = {
      notifications: { claimInTransaction },
    } as unknown as TransactionRepositories;
    let outboxEvents: readonly { readonly eventType: string; readonly telegramTopicId?: bigint | null }[] = [];
    const deps = dependencies(thresholdResult);
    deps.runVote.mockImplementation(async (_db, _input, options) => {
      const factory = options.outbox;
      if (typeof factory !== "function") throw new Error("Expected callback outbox factory");
      outboxEvents = await factory(thresholdResult, repositories);
      return thresholdResult;
    });

    await processTelegramCallback(callbackContext("vote:32:going", 903), deps);

    expect(claimInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      matchId: match.id,
      notificationType: "threshold_reached",
      transitionKey: "threshold:reached:telegram-update:903",
    }));
    expect(outboxEvents.map((event) => event.eventType)).toEqual(["refresh_public_card", "send_notification"]);
    expect(outboxEvents[1]?.telegramTopicId).toBe(apiConfig.telegramChatTopicId);
  });

  it("does not replay a committed vote when callback acknowledgement fails", async () => {
    const deps = dependencies();
    deps.answerCallbackQuery.mockRejectedValue(new Error("telegram unavailable"));

    await expect(processTelegramCallback(callbackContext("vote:32:going"), deps)).resolves.toMatchObject({
      status: "applied",
      updateId: 900n,
    });
    expect(deps.runVote).toHaveBeenCalledOnce();
    expect(deps.refreshPublicCard).toHaveBeenCalledOnce();
  });

  it("refreshes the player avatar after the vote is committed and acknowledged", async () => {
    const events: string[] = [];
    const refreshPlayerAvatar = vi.fn(async () => {
      events.push("avatar");
    });
    const deps = {
      ...dependencies(),
      refreshPlayerAvatar,
    };
    deps.runVote.mockImplementation(async () => {
      events.push("transaction");
      return appliedResult();
    });
    deps.answerCallbackQuery.mockImplementation(async () => {
      events.push("ack");
    });
    deps.refreshPublicCard.mockImplementation(async () => {
      events.push("refresh");
      return { status: "refreshed" };
    });

    await processTelegramCallback(callbackContext("vote:32:going"), deps);

    expect(events).toEqual(["transaction", "ack", "refresh", "avatar"]);
    expect(refreshPlayerAvatar).toHaveBeenCalledWith(55n);
  });

  it("keeps a committed vote successful when avatar refresh fails", async () => {
    const deps = {
      ...dependencies(),
      refreshPlayerAvatar: vi.fn().mockRejectedValue(new Error("avatar unavailable")),
    };

    await expect(processTelegramCallback(callbackContext("vote:32:going"), deps)).resolves.toMatchObject({
      status: "applied",
      updateId: 900n,
    });
    expect(deps.runVote).toHaveBeenCalledOnce();
  });

  it("omits message_thread_id for General topic 1", () => {
    expect(publicCardSendOptions(1n)).toEqual({});
    expect(publicCardSendOptions(42n)).toEqual({ messageThreadId: 42 });
  });

  it("does not contain polling or unbounded timer setup", async () => {
    const source = await readFile(new URL("./telegram-effects.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.start\s*\(/u);
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("getUpdates");
    expect(source).not.toContain("drop_pending_updates");
  });
});
