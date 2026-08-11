import { describe, expect, it } from "vitest";

import { parseTelegramPollUpdate, pollThresholdNotificationTarget } from "./telegram-poll-update.service.js";

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
});
