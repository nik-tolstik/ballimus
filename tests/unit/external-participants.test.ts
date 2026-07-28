import type { ExternalParticipant, Match, Notification } from "../../src/db/schema.js";
import {
  ExternalParticipantService,
  parseExternalParticipantCommand,
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

function fixture() {
  const participants: ExternalParticipant[] = [];
  const notifications: Notification[] = [];
  const sent: string[] = [];
  const repositories: ExternalParticipantRepositories = {
    matches: {
      findById: (matchId) => (matchId === match.id ? match : undefined),
    },
    votes: {
      countGoing: () => 1,
    },
    externalParticipants: {
      countByMatchId: (matchId) =>
        participants
          .filter((participant) => participant.matchId === matchId)
          .reduce((total, participant) => total + participant.quantity, 0),
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
      listByMatchId: (matchId) =>
        notifications.filter((notification) => notification.matchId === matchId),
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
          sentAt: input.sentAt ?? new Date(),
        } as Notification;
        notifications.push(notification);
        return notification;
      },
    },
  };

  return { repositories, participants, sent };
}

describe("external participant commands", () => {
  it("parses a command addressed to this bot", () => {
    expect(parseExternalParticipantCommand("@ballimus_bot +1 для #v32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: 1,
    });
    expect(parseExternalParticipantCommand("@BALLIMUS_BOT +1 для #V32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: 1,
    });
    expect(parseExternalParticipantCommand("@ballimus_bot +10 для #v32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: 10,
    });
    expect(parseExternalParticipantCommand("@ballimus_bot -3 для #v32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: -3,
    });
  });

  it("ignores commands addressed to another bot or with an invalid match ID", () => {
    expect(parseExternalParticipantCommand("@other_bot +1 для #v32", "ballimus_bot")).toBeUndefined();
    expect(parseExternalParticipantCommand("@ballimus_bot +1 для #v0", "ballimus_bot")).toBeUndefined();
    expect(parseExternalParticipantCommand("@ballimus_bot +1 #v32", "ballimus_bot")).toBeUndefined();
  });

  it("counts an external player once and emits the threshold notification once", async () => {
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
      thresholdCrossed: true,
      thresholdNotificationSent: true,
    });
    expect(duplicate).toEqual({ status: "ignored", reason: "duplicate_update" });
    expect(second).toMatchObject({
      status: "added",
      externalCount: 2,
      goingCount: 3,
      thresholdCrossed: false,
      thresholdNotificationSent: false,
    });
    expect(test.participants).toHaveLength(2);
    expect(test.sent).toEqual([
      "⚽ #v32 «27.07.2026 20:00 — СОК Олимпийский» — Набралось 2 игроков — можно играть!",
    ]);
  });

  it("adds a requested number of external players in one command", async () => {
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
});
