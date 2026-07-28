import type { ExternalParticipant, Match, Notification } from "../../src/db/schema.js";
import {
  ExternalParticipantService,
  type ExternalParticipantRepositories,
} from "../../src/application/external-participants.js";
import { describe, expect, it } from "vitest";

const match = {
  id: 32,
  chatId: -100,
  scheduledAt: new Date("2026-07-27T17:00:00.000Z"),
  location: "СОК Олимпийский",
  title: "27.07.2026 20:00 — СОК Олимпийский",
  requiredPlayers: 2,
  status: "active",
  creatorTelegramUserId: 99,
  createdAt: new Date("2026-07-26T00:00:00.000Z"),
  updatedAt: new Date("2026-07-26T00:00:00.000Z"),
} as Match;

function fixture(currentMatch: Match = match) {
  const participants: ExternalParticipant[] = [];
  const notifications: Notification[] = [];
  const sent: string[] = [];
  const repositories: ExternalParticipantRepositories = {
    matches: {
      findById: (matchId) => (matchId === currentMatch.id ? currentMatch : undefined),
    },
    votes: {
      countGoing: () => 1,
    },
    externalParticipants: {
      countByMatchId: (matchId) =>
        participants
          .filter((participant) => participant.matchId === matchId)
          .reduce((total, participant) => total + participant.quantity, 0),
      countByMatchIdAndSourceLabel: (matchId, sourceLabel) =>
        participants
          .filter(
            (participant) =>
              participant.matchId === matchId && participant.sourceLabel === sourceLabel,
          )
          .reduce((total, participant) => total + participant.quantity, 0),
      countByMatchIdWithoutSourceLabel: (matchId) =>
        participants
          .filter(
            (participant) => participant.matchId === matchId && participant.sourceLabel === null,
          )
          .reduce((total, participant) => total + participant.quantity, 0),
      countByMatchIdAndAddedByTelegramUserId: (matchId, telegramUserId) =>
        participants
          .filter(
            (participant) =>
              participant.matchId === matchId &&
              participant.addedByTelegramUserId === telegramUserId &&
              participant.sourceLabel === null,
          )
          .reduce((total, participant) => total + participant.quantity, 0),
      findBySourceUpdateId: (sourceUpdateId) =>
        participants.find((participant) => participant.sourceUpdateId === sourceUpdateId),
      add: (input) => {
        if (participants.some((participant) => participant.sourceUpdateId === input.sourceUpdateId)) {
          return undefined;
        }
        const participant = {
          id: participants.length + 1,
          ...input,
          createdAt: new Date(),
        } as ExternalParticipant;
        participants.push(participant);
        return participant;
      },
    },
    notifications: {
      claim: (input) => {
        if (
          notifications.some(
            (notification) =>
              notification.matchId === input.matchId &&
              notification.notificationType === input.notificationType &&
              notification.transitionKey === input.transitionKey,
          )
        ) {
          return undefined;
        }
        const notification = {
          id: notifications.length + 1,
          ...input,
          sentAt: new Date(),
        } as Notification;
        notifications.push(notification);
        return notification;
      },
    },
  };

  return { repositories, participants, notifications, sent };
}

describe("external participants", () => {

  it("counts an external player once and announces an upward threshold crossing", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    const first = await service.add({
      matchId: match.id,
      updateId: 10,
      addedByTelegramUserId: 7,
      quantity: 1,
    });
    const duplicate = await service.add({
      matchId: match.id,
      updateId: 10,
      addedByTelegramUserId: 7,
      quantity: 1,
    });
    const second = await service.add({
      matchId: match.id,
      updateId: 11,
      addedByTelegramUserId: 8,
      quantity: 1,
    });

    expect(first).toMatchObject({
      status: "added",
      externalCount: 1,
      goingCount: 2,
      thresholdReached: true,
      thresholdLost: false,
      thresholdReachedNotificationSent: true,
      thresholdLostNotificationSent: false,
      thresholdCrossed: true,
      thresholdNotificationSent: true,
    });
    expect(duplicate).toEqual({ status: "ignored", reason: "duplicate_update" });
    expect(second).toMatchObject({
      status: "added",
      externalCount: 2,
      goingCount: 3,
      thresholdReached: false,
      thresholdLost: false,
      thresholdReachedNotificationSent: false,
      thresholdLostNotificationSent: false,
      thresholdCrossed: false,
      thresholdNotificationSent: false,
    });
    expect(test.participants).toHaveLength(2);
    expect(test.sent).toEqual([
      "#v32 «27.07.2026 20:00 — СОК Олимпийский» — Набралось 2/2 игроков — можно играть!",
    ]);
  });

  it("supports historical quantity batches in the application service", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    const result = await service.add({
      matchId: match.id,
      updateId: 20,
      addedByTelegramUserId: 7,
      quantity: 10,
    });

    expect(result).toMatchObject({
      status: "added",
      externalCount: 10,
      goingCount: 11,
      thresholdCrossed: true,
      thresholdNotificationSent: true,
    });
    expect(test.participants).toHaveLength(1);
  });

  it("removes external players without changing native votes", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    await service.add({
      matchId: match.id,
      updateId: 30,
      addedByTelegramUserId: 7,
      quantity: 10,
    });
    const result = await service.add({
      matchId: match.id,
      updateId: 31,
      addedByTelegramUserId: 7,
      quantity: -3,
    });

    expect(result).toMatchObject({
      status: "added",
      externalCount: 7,
      goingCount: 8,
      thresholdCrossed: false,
    });
    expect(test.participants.map((participant) => participant.quantity)).toEqual([10, -3]);
  });

  it("stores the display snapshot and lets each user remove only their own players", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    await service.add({
      matchId: match.id,
      updateId: 32,
      addedByTelegramUserId: 7,
      quantity: 2,
      sourceLabel: null,
      displayNameSnapshot: "Ваня",
      removeOnlyOwn: true,
    });
    await service.add({
      matchId: match.id,
      updateId: 33,
      addedByTelegramUserId: 8,
      quantity: 1,
      sourceLabel: null,
      displayNameSnapshot: "Петя",
      removeOnlyOwn: true,
    });

    const otherPlayers = await service.add({
      matchId: match.id,
      updateId: 34,
      addedByTelegramUserId: 8,
      quantity: -2,
      sourceLabel: null,
      removeOnlyOwn: true,
    });
    const ownPlayers = await service.add({
      matchId: match.id,
      updateId: 35,
      addedByTelegramUserId: 7,
      quantity: -1,
      sourceLabel: null,
      removeOnlyOwn: true,
    });

    expect(otherPlayers).toEqual({
      status: "ignored",
      reason: "insufficient_external_players",
    });
    expect(ownPlayers).toMatchObject({ status: "added", externalCount: 2 });
    expect(test.participants).toEqual([
      expect.objectContaining({
        addedByTelegramUserId: 7,
        displayNameSnapshot: "Ваня",
        quantity: 2,
      }),
      expect.objectContaining({
        addedByTelegramUserId: 8,
        displayNameSnapshot: "Петя",
        quantity: 1,
      }),
      expect.objectContaining({
        addedByTelegramUserId: 7,
        quantity: -1,
      }),
    ]);
  });

  it("announces threshold loss and a later repeated threshold reach", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    const reached = await service.add({
      matchId: match.id,
      updateId: 35,
      addedByTelegramUserId: 7,
      quantity: 1,
    });
    const lost = await service.add({
      matchId: match.id,
      updateId: 36,
      addedByTelegramUserId: 7,
      quantity: -1,
    });
    const reachedAgain = await service.add({
      matchId: match.id,
      updateId: 37,
      addedByTelegramUserId: 7,
      quantity: 1,
    });

    expect(reached).toMatchObject({
      thresholdReached: true,
      thresholdLost: false,
      thresholdReachedNotificationSent: true,
      thresholdLostNotificationSent: false,
    });
    expect(lost).toMatchObject({
      thresholdReached: false,
      thresholdLost: true,
      thresholdReachedNotificationSent: false,
      thresholdLostNotificationSent: true,
    });
    expect(reachedAgain).toMatchObject({
      thresholdReached: true,
      thresholdLost: false,
      thresholdReachedNotificationSent: true,
      thresholdLostNotificationSent: false,
    });
    expect(test.notifications.map((notification) => notification.transitionKey)).toEqual([
      "threshold:reached:35",
      "threshold:lost:36",
      "threshold:reached:37",
    ]);
    expect(test.sent).toEqual([
      "#v32 «27.07.2026 20:00 — СОК Олимпийский» — Набралось 2/2 игроков — можно играть!",
      "#v32 «27.07.2026 20:00 — СОК Олимпийский» — Игроков снова меньше минимума. Сейчас: 1/2",
      "#v32 «27.07.2026 20:00 — СОК Олимпийский» — Набралось 2/2 игроков — можно играть!",
    ]);
  });

  it("rejects removing more external players than have been added", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    const result = await service.add({
      matchId: match.id,
      updateId: 40,
      addedByTelegramUserId: 7,
      quantity: -1,
    });

    expect(result).toEqual({
      status: "ignored",
      reason: "insufficient_external_players",
    });
    expect(test.participants).toHaveLength(0);
  });

  it("blocks additions for completed and cancelled matches", async () => {
    for (const status of ["completed", "cancelled"] as const) {
      const test = fixture({ ...match, status });
      const service = new ExternalParticipantService({
        repositories: test.repositories,
        notifier: { send: async (text) => { test.sent.push(text); } },
      });

      const result = await service.add({
        matchId: match.id,
        updateId: status === "completed" ? 41 : 42,
        addedByTelegramUserId: 7,
        quantity: 1,
        removeOnlyOwn: true,
      });

      expect(result).toEqual({ status: "ignored", reason: "inactive_match" });
      expect(test.participants).toHaveLength(0);
    }
  });

  it("persists an attribution label and only removes players from that label", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    await service.add({
      matchId: match.id,
      updateId: 50,
      addedByTelegramUserId: 7,
      quantity: 2,
      sourceLabel: "Никиты",
    });
    await service.add({
      matchId: match.id,
      updateId: 51,
      addedByTelegramUserId: 7,
      quantity: 3,
      sourceLabel: "Алексея",
    });
    const result = await service.add({
      matchId: match.id,
      updateId: 52,
      addedByTelegramUserId: 7,
      quantity: -3,
      sourceLabel: "Никиты",
    });

    expect(test.participants.map((participant) => participant.sourceLabel)).toEqual([
      "Никиты",
      "Алексея",
    ]);
    expect(result).toEqual({
      status: "ignored",
      reason: "insufficient_external_players",
    });
  });

  it("does not let a legacy removal consume attributed players", async () => {
    const test = fixture();
    const service = new ExternalParticipantService({
      repositories: test.repositories,
      notifier: { send: async (text) => { test.sent.push(text); } },
    });

    await service.add({
      matchId: match.id,
      updateId: 60,
      addedByTelegramUserId: 7,
      quantity: 2,
      sourceLabel: "Никиты",
    });
    const result = await service.add({
      matchId: match.id,
      updateId: 61,
      addedByTelegramUserId: 7,
      quantity: -1,
    });

    expect(result).toEqual({
      status: "ignored",
      reason: "insufficient_external_players",
    });
    expect(test.participants).toHaveLength(1);
    expect(test.participants[0]).toMatchObject({ sourceLabel: "Никиты", quantity: 2 });
  });
});
