import { describe, expect, it } from "vitest";

import { formatPollThresholdNotification, formatPollWithdrawalNotification } from "./poll.js";

describe("native Telegram poll notifications", () => {
  it("identifies the threshold option and escapes Telegram HTML", () => {
    expect(formatPollThresholdNotification({
      question: "Играем <сегодня>?",
      optionText: "Да & беру мяч",
      threshold: 10,
    })).toBe("🙌 <b>Набралось 10 человек</b>\nОпрос: Играем &lt;сегодня&gt;?\nВариант: Да &amp; беру мяч");
  });

  it("identifies the voter who takes an option below its threshold", () => {
    expect(formatPollWithdrawalNotification({
      question: "Играем <сегодня>?",
      optionText: "Да & беру мяч",
      threshold: 10,
      voterCount: 9,
      username: "player_one",
      displayName: "Player One",
    })).toBe(
      "⚠️ <b>Голосов снова недостаточно</b>\n"
      + "Опрос: Играем &lt;сегодня&gt;?\n"
      + "Вариант: Да &amp; беру мяч\n"
      + "Сейчас: 9 из 10\n"
      + "Отменил голос: @player_one",
    );
  });

  it("falls back to the escaped display name when Telegram has no username", () => {
    expect(formatPollWithdrawalNotification({
      question: "Играем?",
      optionText: "Да",
      threshold: 1,
      voterCount: 0,
      username: null,
      displayName: "Иван <Иванов>",
    })).toContain("Отменил голос: Иван &lt;Иванов&gt;");
  });
});
