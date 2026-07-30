import { describe, expect, it, vi } from "vitest";
import type { Match, TransactionRepositories } from "@football/db";

import {
  claimLifecycleNotificationEvent,
  claimThresholdNotificationEvent,
} from "./notification-events.js";

const match = {
  id: 12n,
  telegramChatId: -100n,
  scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
  location: "Field",
  venueType: "outdoor",
  fieldPriceRubles: null,
  title: "Evening <match>",
  requiredPlayers: 3,
  status: "active",
  cancellationReason: null,
  creatorTelegramUserId: 1n,
  version: 1,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
} as Match;

function repositories() {
  const claimInTransaction = vi.fn().mockResolvedValue({ status: "claimed", notification: { id: 55n } });
  const listByMatchId = vi.fn().mockResolvedValue([]);
  const rosterCounts = vi.fn().mockResolvedValue({ goingVotes: 0, externalParticipants: 0, goingCount: 0, requiredPlayers: 3, thresholdReached: false, remainingToThreshold: 3 });
  return {
    value: { notifications: { claimInTransaction }, votes: { listByMatchId, rosterCounts } } as unknown as TransactionRepositories,
    claimInTransaction,
    listByMatchId,
    rosterCounts,
  };
}

describe("application notification events", () => {
  it("claims repeatable threshold crossings with operation-specific keys", async () => {
    const fixture = repositories();
    const event = await claimThresholdNotificationEvent(fixture.value, {
      match: {
        ...match,
        scheduledAt: null,
        scheduleDate: "2026-08-03",
        timeMode: "availability",
        timeOptions: ["19:00", "20:00"],
        selectedTime: null,
        location: "BOX365",
      },
      countsAfter: { goingVotes: 3, externalParticipants: 0, goingCount: 3, requiredPlayers: 3, thresholdReached: true, remainingToThreshold: 0 },
      thresholdReached: true,
      thresholdLost: false,
    }, "owner-mutation:abc", 42n);

    expect(fixture.claimInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: "threshold_reached",
      transitionKey: "threshold:reached:owner-mutation:abc",
    }));
    expect(event).toMatchObject({ eventType: "send_notification", notificationId: 55n, telegramTopicId: 42n });
    expect(event?.payload?.["text"]).toBe(
      "⚽ <b>Минимальный состав собран!</b>\n" +
      "<b>#v12 · 03.08.2026 · BOX365</b>\n" +
      "👥 Игроков: <b>3 из 3</b>\n\n" +
      "Нужно указать точное время проведения матча.",
    );
  });

  it("includes the player whose vote caused the threshold to be lost", async () => {
    const fixture = repositories();
    const event = await claimThresholdNotificationEvent(fixture.value, {
      match: { ...match, scheduleDate: "2026-08-03" },
      countsAfter: { goingVotes: 0, externalParticipants: 0, goingCount: 0, requiredPlayers: 1, thresholdReached: false, remainingToThreshold: 1 },
      thresholdReached: false,
      thresholdLost: true,
      previousVote: {
        matchId: 12n,
        playerId: 9n,
        telegramUserId: 101n,
        usernameSnapshot: "ivan",
        firstNameSnapshot: "Иван",
        lastNameSnapshot: null,
        displayNameSnapshot: "Иван & Пётр",
        option: "going",
        availableAfter: null,
        exactTimes: [],
        source: "telegram_callback",
        telegramUpdateId: 1n,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    }, "telegram-update:123", 42n);

    expect(event?.payload?.["text"]).toBe(
      "⚠️ <b>Минимальный состав снова не набран</b>\n" +
      "<b>#v12 · 03.08.2026 · Field</b>\n" +
      "👥 Игроков: <b>0 из 3</b>\n\n" +
      "↩️ Голос отменил: <b>@ivan</b>",
    );
  });

  it("claims the stable lifecycle transition for cancellation", async () => {
    const fixture = repositories();
    const event = await claimLifecycleNotificationEvent(fixture.value, {
      ...match,
      status: "cancelled",
      cancellationReason: "Rain & wind",
    }, 42n, "Europe/Minsk");

    expect(fixture.claimInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: "match_cancelled",
      transitionKey: "status:cancelled",
    }));
    expect(event?.payload?.["text"]).toContain("Rain &amp; wind");
  });

  it("mentions only Going voters in the confirmed-match notification", async () => {
    const fixture = repositories();
    fixture.listByMatchId.mockResolvedValue([
      { matchId: 12n, telegramUserId: 101n, displayNameSnapshot: "Никита", usernameSnapshot: "nikita", option: "going" },
      { matchId: 12n, telegramUserId: 102n, displayNameSnapshot: "Максим", usernameSnapshot: "max", option: "maybe" },
      { matchId: 12n, telegramUserId: 103n, displayNameSnapshot: "Антон", usernameSnapshot: null, option: "not_going" },
    ]);
    fixture.rosterCounts.mockResolvedValue({ goingVotes: 1, externalParticipants: 2, goingCount: 3, requiredPlayers: 3, thresholdReached: true, remainingToThreshold: 0 });

    const event = await claimLifecycleNotificationEvent(fixture.value, {
      ...match,
      status: "confirmed",
    }, 42n, "Europe/Minsk");

    const text = String(event?.payload?.["text"]);
    expect(text).toContain("⚽ <b>Состав набран — матч состоится!</b>");
    expect(text).toContain("🗓 Понедельник, 3 августа · 20:00");
    expect(text).toContain("💰 Стоимость поля: не указана");
    expect(text).toContain("👥 Идут: 3 игрока");
    expect(text).toContain('<a href="tg://user?id=101">Никита</a>');
    expect(text).not.toContain("Максим");
    expect(text).not.toContain("Антон");
  });
});
