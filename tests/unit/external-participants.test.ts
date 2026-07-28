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
  const participants: Array<ExternalParticipant & { sourceLabel: string | null }> = [];
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
      add: (input) => {
        if (participants.some((participant) => participant.sourceUpdateId === input.sourceUpdateId)) {
          return undefined;
        }
        const participant = {
          id: participants.length + 1,
          ...input,
          createdAt: new Date(),
        } as ExternalParticipant & { sourceLabel: string | null };
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

describe("external participant commands", () => {
  it("parses a command addressed to this bot", () => {
    expect(parseExternalParticipantCommand("@ballimus_bot +1 для #v32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: 1,
      sourceLabel: null,
    });
    expect(parseExternalParticipantCommand("@BALLIMUS_BOT +1 для #V32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: 1,
      sourceLabel: null,
    });
    expect(parseExternalParticipantCommand("@ballimus_bot +10 для #v32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: 10,
      sourceLabel: null,
    });
    expect(parseExternalParticipantCommand("@ballimus_bot -3 для #v32", "ballimus_bot")).toEqual({
      matchId: 32,
      quantity: -3,
      sourceLabel: null,
    });
  });

  it("parses attributed additions and removals while keeping the legacy syntax", () => {
    expect(
      parseExternalParticipantCommand(
        "@ballimus_bot от Никиты +3 игрока для #v32",
        "ballimus_bot",
      ),
    ).toEqual({
      matchId: 32,
      quantity: 3,
      sourceLabel: "Никиты",
    });
    expect(
      parseExternalParticipantCommand(
        "@ballimus_bot от   Никиты   -1 игроков для #v32",
        "ballimus_bot",
      ),
    ).toEqual({
      matchId: 32,
      quantity: -1,
      sourceLabel: "Никиты",
    });
  });

  it("ignores commands addressed to another bot or with an invalid match ID", () => {
    expect(parseExternalParticipantCommand("@other_bot +1 для #v32", "ballimus_bot")).toBeUndefined();
    expect(parseExternalParticipantCommand("@ballimus_bot +1 для #v0", "ballimus_bot")).toBeUndefined();
    expect(parseExternalParticipantCommand("@ballimus_bot +1 #v32", "ballimus_bot")).toBeUndefined();
  });

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
