import { describe, expect, it } from "vitest";

import {
  formatConfirmationNotification,
  formatParticipantMention,
  formatCancellationNotification,
  formatThresholdNotification,
  formatWithdrawalNotification,
} from "../../src/domain/notifications.js";

describe("notification formatting", () => {
  it("prefers a username", () => {
    expect(
      formatParticipantMention({ telegramUserId: 1, username: "ivan", displayName: "Ivan" }),
    ).toBe("@ivan");
  });

  it("uses a clickable escaped mention when no username exists", () => {
    expect(
      formatParticipantMention({ telegramUserId: 2, displayName: "<Аня> & Ко" }),
    ).toBe('<a href="tg://user?id=2">&lt;Аня&gt; &amp; Ко</a>');
  });

  it("formats the required messages", () => {
    expect(formatThresholdNotification(9, "Четверг 20:00-21:30", 10)).toBe(
      "⚽ #v9 «Четверг 20:00-21:30» — Набралось 10 игроков — можно играть!",
    );
    expect(
      formatWithdrawalNotification(
        9,
        "Четверг 20:00-21:30",
        { telegramUserId: 3, username: "ivan", displayName: "Ivan" },
        9,
        10,
      ),
    ).toBe("⚠️ #v9 «Четверг 20:00-21:30» — @ivan отменил участие. Сейчас: 9/10");
    expect(formatCancellationNotification(9, "Четверг 20:00-21:30")).toBe(
      "🚫 #v9 «Четверг 20:00-21:30» — матч отменён.",
    );
    expect(formatConfirmationNotification(9, "Четверг 20:00-21:30")).toBe(
      "✅ #v9 «Четверг 20:00-21:30» — матч состоится.",
    );
  });
});
