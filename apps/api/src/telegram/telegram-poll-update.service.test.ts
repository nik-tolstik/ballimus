import { describe, expect, it, vi } from "vitest";

import {
  DelayedTaskRegistry,
  POLL_WITHDRAWAL_GRACE_PERIOD_MS,
  parseTelegramPollAnswerUpdate,
  parseTelegramPollUpdate,
  pollThresholdNotificationTarget,
  sendPollThresholdNotifications,
  sendPollWithdrawalNotifications,
  TelegramPollUpdateService,
} from "./telegram-poll-update.service.js";

describe("Telegram poll webhook parsing", () => {
  it("accepts a native poll count update", () => {
    expect(parseTelegramPollUpdate({
      update_id: 1,
      poll: {
        id: "poll-1",
        options: [
          { text: "Да", voter_count: 10 },
          { text: "Нет", voter_count: 2 },
        ],
        is_closed: false,
      },
    })).toEqual({
      pollId: "poll-1",
      options: [{ text: "Да", voterCount: 10 }, { text: "Нет", voterCount: 2 }],
      isClosed: false,
    });
  });

  it("ignores unrelated or malformed updates", () => {
    expect(parseTelegramPollUpdate({ update_id: 1, message: {} })).toBeUndefined();
    expect(parseTelegramPollUpdate({ poll: { id: "poll-1", options: [{ text: "Да", voter_count: -1 }], is_closed: false } })).toBeUndefined();
  });

  it("accepts a non-anonymous voter answer and cancellation", () => {
    expect(parseTelegramPollAnswerUpdate({
      update_id: 12,
      poll_answer: {
        poll_id: "poll-1",
        user: { id: 700001, first_name: "Иван", last_name: "Иванов", username: "player_one" },
        option_ids: [],
      },
    })).toEqual({
      telegramUpdateId: 12n,
      pollId: "poll-1",
      voterKind: "user",
      telegramVoterId: 700001n,
      username: "player_one",
      displayName: "Иван Иванов",
      selectedOptionIndexes: [],
    });
  });

  it("rejects malformed or duplicate poll answer options", () => {
    expect(parseTelegramPollAnswerUpdate({
      update_id: 12,
      poll_answer: { poll_id: "poll-1", user: { id: 1, first_name: "Иван" }, option_ids: [0, 0] },
    })).toBeUndefined();
  });

  it("routes threshold notifications to Chat independently from the poll topic", () => {
    expect(pollThresholdNotificationTarget(
      { telegramChatTopicId: 42n },
      { telegramChatId: -100n },
    )).toEqual({ telegramChatId: -100n, telegramTopicId: 42n });
  });

  it("attempts threshold notifications directly once and does not retry failures", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("Telegram unavailable"))
      .mockResolvedValueOnce({ messageId: 2n });

    await expect(sendPollThresholdNotifications({ sendMessage }, [
      { chatId: -100n, messageThreadId: 42n, question: "Играем?", optionText: "Да", threshold: 10 },
      { chatId: -100n, messageThreadId: 42n, question: "Играем?", optionText: "Возможно", threshold: 10 },
    ])).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      chatId: -100n,
      messageThreadId: 42n,
      text: "🙌 <b>Набралось 10 человек</b>\nОпрос: Играем?\nВариант: Да",
    });
  });

  it("sends a direct withdrawal alert with the Telegram username", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 3n });

    await expect(sendPollWithdrawalNotifications({ sendMessage }, [{
      chatId: -100n,
      messageThreadId: 42n,
      question: "Играем?",
      optionText: "Да",
      threshold: 1,
      voterCount: 0,
      username: "player_one",
      displayName: "Player One",
    }])).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith({
      chatId: -100n,
      messageThreadId: 42n,
      text: "⚠️ <b>Голосов снова недостаточно</b>\nОпрос: Играем?\nВариант: Да\nСейчас: 0 из 1\nОтменил голос: @player_one",
    });
  });

  it("delays, replaces, and cancels pending withdrawal work", async () => {
    vi.useFakeTimers();
    try {
      const first = vi.fn().mockResolvedValue(undefined);
      const replacement = vi.fn().mockResolvedValue(undefined);
      const cancelled = vi.fn().mockResolvedValue(undefined);
      const registry = new DelayedTaskRegistry(10_000);

      registry.schedule("poll-1:0", first);
      await vi.advanceTimersByTimeAsync(5_000);
      registry.schedule("poll-1:0", replacement);
      registry.schedule("poll-1:1", cancelled);
      registry.cancel("poll-1:1");

      await vi.advanceTimersByTimeAsync(9_999);
      expect(first).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(replacement).toHaveBeenCalledTimes(1);
      expect(cancelled).not.toHaveBeenCalled();
      registry.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending withdrawal check when an option notification is disabled", async () => {
    vi.useFakeTimers();
    try {
      const service = new TelegramPollUpdateService({} as never, {} as never, {} as never);
      const registry = (service as unknown as { delayedWithdrawals: DelayedTaskRegistry }).delayedWithdrawals;
      const task = vi.fn().mockResolvedValue(undefined);
      registry.schedule("1:0", task);

      service.cancelWithdrawalNotifications(1n, [0]);
      await vi.advanceTimersByTimeAsync(POLL_WITHDRAWAL_GRACE_PERIOD_MS);

      expect(task).not.toHaveBeenCalled();
      service.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
