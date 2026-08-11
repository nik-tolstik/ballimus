import { describe, expect, it, vi } from "vitest";

import { parseTelegramPollUpdate, pollThresholdNotificationTarget, sendPollThresholdNotifications } from "./telegram-poll-update.service.js";

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
});
