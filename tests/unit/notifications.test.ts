import { describe, expect, it } from "vitest";

import {
  formatCancellationNotification,
  formatConfirmationNotification,
  formatThresholdLostNotification,
  formatThresholdNotification,
} from "../../src/domain/notifications.js";

describe("notification formatting", () => {
  it("formats threshold transition messages", () => {
    expect(formatThresholdNotification(9, "Четверг 20:00-21:30", 12, 10)).toBe(
      "#v9 «Четверг 20:00-21:30» — Набралось 12/10 игроков — можно играть!",
    );
    expect(formatThresholdLostNotification(9, "Четверг 20:00-21:30", 9, 10)).toBe(
      "#v9 «Четверг 20:00-21:30» — Игроков снова меньше минимума. Сейчас: 9/10",
    );
  });

  it("formats cancellation reason and escapes supplied text", () => {
    expect(formatCancellationNotification(9, "Плохая погода")).toBe(
      "Матч #v9 отменён.\nПричина: Плохая погода.",
    );
    expect(formatCancellationNotification(9, "<дождь>")).toBe(
      "Матч #v9 отменён.\nПричина: &lt;дождь&gt;.",
    );
  });

  it("formats confirmation", () => {
    expect(formatConfirmationNotification(9, "Четверг 20:00-21:30")).toBe(
      "#v9 «Четверг 20:00-21:30» — матч состоится.",
    );
  });
});
