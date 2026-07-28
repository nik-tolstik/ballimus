import type { Match, Notification, Vote } from "../../src/db/schema.js";
import {
  MatchActionService,
  type MatchActionRepositories,
} from "../../src/application/match-actions.js";
import type { MatchCallbackUpdate } from "../../src/application/match-card.js";
import { describe, expect, it } from "vitest";

const baseMatch = {
  id: 1,
  chatId: -100,
  scheduledAt: new Date("2026-07-27T17:00:00.000Z"),
  location: "СОК Олимпийский",
  fieldPriceRubles: null,
  title: "27.07.2026 20:00 — СОК Олимпийский",
  requiredPlayers: 2,
  status: "active",
  creatorTelegramUserId: 7,
  createdAt: new Date("2026-07-26T00:00:00.000Z"),
  updatedAt: new Date("2026-07-26T00:00:00.000Z"),
} as Match;

interface Fixture {
  repositories: MatchActionRepositories;
  match: Match;
  votes: Vote[];
  notifications: Notification[];
  sent: string[];
  refreshed: number[];
}

function fixture(externalCount = 0): Fixture {
  const match = { ...baseMatch } as Match;
  const votes: Vote[] = [];
  const notifications: Notification[] = [];
  const processed = new Set<number>();
  const sent: string[] = [];
  const refreshed: number[] = [];

  const repositories: MatchActionRepositories = {
    matchActions: {
      applyVote: (input) => {
        if (processed.has(input.updateId)) {
          return { status: "duplicate", processedMatchId: input.matchId };
        }
        if (match.status !== "active" && match.status !== "confirmed") {
          return { status: "inactive_match", match };
        }
        const previousVote = votes.find(
          (vote) => vote.matchId === input.matchId && vote.telegramUserId === input.telegramUserId,
        );
        const goingCountBefore =
          votes.filter((vote) => vote.matchId === input.matchId && vote.option === "going").length +
          externalCount;
        const value = {
          matchId: input.matchId,
          telegramUserId: input.telegramUserId,
          usernameSnapshot: input.usernameSnapshot,
          displayNameSnapshot: input.displayNameSnapshot,
          option: input.option,
          updatedAt: new Date(),
        } as Vote;
        const index = votes.indexOf(previousVote as Vote);
        if (previousVote === undefined) votes.push(value);
        else votes[index] = value;
        processed.add(input.updateId);
        return {
          status: "applied",
          match,
          previousVote,
          goingCountBefore,
          goingCountAfter:
            votes.filter((vote) => vote.matchId === input.matchId && vote.option === "going").length +
            externalCount,
          externalCount,
        };
      },
      changeStatus: (input) => {
        if (processed.has(input.updateId)) {
          return { status: "duplicate", processedMatchId: input.matchId };
        }
        if (match.status !== "active" && match.status !== "confirmed") {
          return { status: "inactive_match", match };
        }
        match.status = input.status;
        processed.add(input.updateId);
        return { status: "changed", match };
      },
    },
    matches: {
      findById: (matchId) => (matchId === match.id ? match : undefined),
    },
    matchMessages: {
      findByChatAndMessageId: (chatId, messageId, kind) => {
        if (kind === "public_card" && chatId === -100 && messageId === 10) {
          return { matchId: 1, chatId, messageId, kind };
        }
        if (kind === "admin_panel" && chatId === 7 && messageId === 11) {
          return { matchId: 1, chatId, messageId, kind };
        }
        return undefined;
      },
    },
    notifications: {
      listByMatchId: (matchId) => notifications.filter((item) => item.matchId === matchId),
      claim: (input) => {
        const exists = notifications.some(
          (item) =>
            item.matchId === input.matchId &&
            item.notificationType === input.notificationType &&
            item.transitionKey === input.transitionKey,
        );
        if (exists) return undefined;
        const value = {
          id: notifications.length + 1,
          matchId: input.matchId,
          notificationType: input.notificationType,
          transitionKey: input.transitionKey,
          sentAt: new Date(),
        } as Notification;
        notifications.push(value);
        return value;
      },
      delete: (id) => {
        const index = notifications.findIndex((item) => item.id === id);
        if (index === -1) return false;
        notifications.splice(index, 1);
        return true;
      },
    },
  };

  return { repositories, match, votes, notifications, sent, refreshed };
}

function update(
  updateId: number,
  userId: number,
  option: "going" | "maybe" | "not_going",
  messageId = 10,
): MatchCallbackUpdate {
  return {
    updateId,
    callbackQueryId: `callback-${updateId}`,
    telegramUserId: userId,
    username: userId === 10 ? "ivan" : null,
    displayName: userId === 10 ? "Иван" : "Игрок",
    chatId: messageId === 11 ? userId : -100,
    messageId,
    action: { kind: "vote", matchId: 1, option },
  };
}

function serviceFor(test: Fixture, admin = true) {
  return new MatchActionService({
    repositories: test.repositories,
    notifier: {
      send: async (text) => {
        test.sent.push(text);
      },
    },
    refreshCard: async (matchId) => {
      test.refreshed.push(matchId);
    },
    isAdmin: () => admin,
  });
}

describe("match callback actions", () => {
  it("persists votes and refreshes the card", async () => {
    const test = fixture();
    const service = serviceFor(test);

    const result = await service.process(update(1, 10, "going"));

    expect(result).toMatchObject({ status: "processed", answer: "Ваш выбор сохранён: участвую" });
    expect(test.votes[0]?.option).toBe("going");
    expect(test.refreshed).toEqual([1]);
  });

  it("announces threshold once and warns about a confirmed withdrawal", async () => {
    const test = fixture();
    const service = serviceFor(test);

    await service.process(update(10, 10, "going"));
    const threshold = await service.process(update(11, 11, "going"));
    const withdrawal = await service.process(update(12, 10, "maybe"));
    const duplicate = await service.process(update(12, 10, "maybe"));

    expect(threshold).toMatchObject({ status: "processed" });
    expect(withdrawal).toMatchObject({ status: "processed" });
    expect(duplicate).toEqual({ status: "ignored", answer: "Это действие уже обработано" });
    expect(test.sent).toEqual([
      "⚽ #v1 «27.07.2026 20:00 — СОК Олимпийский» — Набралось 2 игроков — можно играть!",
      '⚠️ #v1 «27.07.2026 20:00 — СОК Олимпийский» — @ivan отменил участие. Сейчас: 1/2',
    ]);
  });

  it("includes external players in the threshold count", async () => {
    const test = fixture(1);
    const service = serviceFor(test);

    await service.process(update(20, 10, "going"));

    expect(test.sent).toEqual([
      "⚽ #v1 «27.07.2026 20:00 — СОК Олимпийский» — Набралось 2 игроков — можно играть!",
    ]);
  });

  it("does not warn for changes between non-going options", async () => {
    const test = fixture();
    const service = serviceFor(test);

    await service.process(update(1, 10, "not_going"));
    await service.process(update(2, 10, "maybe"));

    expect(test.sent).toHaveLength(0);
  });

  it("allows only the creator to complete a match and freezes later votes", async () => {
    const test = fixture();
    const service = serviceFor(test);

    const forbidden = await service.process({
      ...update(1, 10, "going", 11),
      chatId: 10,
      messageId: 11,
      action: { kind: "complete", matchId: 1 },
    });
    expect(forbidden.status).toBe("ignored");

    const completedTooEarly = await service.process({
      ...update(2, 7, "going", 11),
      chatId: 7,
      messageId: 11,
      action: { kind: "complete", matchId: 1 },
    });
    expect(completedTooEarly).toMatchObject({
      status: "ignored",
      answer: "Сначала подтвердите, что матч состоится",
    });

    const confirmed = await service.process({
      ...update(3, 7, "going", 11),
      chatId: 7,
      messageId: 11,
      action: { kind: "confirm", matchId: 1 },
    });
    expect(confirmed).toMatchObject({ status: "processed", answer: "Матч подтверждён" });
    expect(test.match.status).toBe("confirmed");

    const completed = await service.process({
      ...update(4, 7, "going", 11),
      chatId: 7,
      messageId: 11,
      action: { kind: "complete", matchId: 1 },
    });
    expect(completed).toMatchObject({ status: "processed", answer: "Матч завершён" });
    expect(test.match.status).toBe("completed");

    const staleVote = await service.process(update(5, 10, "going"));
    expect(staleVote).toEqual({
      status: "ignored",
      answer: "Матч уже завершён",
    });
  });

  it("cancels a match and sends an idempotent cancellation notification", async () => {
    const test = fixture();
    const service = serviceFor(test);
    const action = {
      ...update(30, 7, "going", 11),
      chatId: 7,
      messageId: 11,
      action: { kind: "cancel" as const, matchId: 1 },
    };

    const first = await service.process(action);
    const second = await service.process(action);

    expect(first).toMatchObject({ status: "processed", answer: "Матч отменён" });
    expect(second.status).toBe("ignored");
    expect(test.sent).toEqual([
      "🚫 #v1 «27.07.2026 20:00 — СОК Олимпийский» — матч отменён.",
    ]);
  });
});
