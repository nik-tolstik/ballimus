import { describe, expect, it } from "vitest";

import { formatPollThresholdNotification } from "./poll.js";

describe("native Telegram poll notifications", () => {
  it("identifies the threshold option and escapes Telegram HTML", () => {
    expect(formatPollThresholdNotification({
      question: "Играем <сегодня>?",
      optionText: "Да & беру мяч",
      threshold: 10,
    })).toBe("🙌 <b>Набралось 10 человек</b>\nОпрос: Играем &lt;сегодня&gt;?\nВариант: Да &amp; беру мяч");
  });
});
