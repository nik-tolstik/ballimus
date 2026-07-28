import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type DatabaseClient } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";

describe("persistence repositories", () => {
  let client: DatabaseClient;
  let repositories: Repositories;

  beforeEach(() => {
    client = createTestDatabase();
    repositories = createRepositories(client.db);
    repositories.chatSettings.create({
      chatId: -1001234567890,
      generalTopicId: 1,
      chatTopicId: 42,
      timezone: "Europe/Minsk",
      defaultThreshold: 10,
    });
  });

  afterEach(() => {
    client.close();
  });

  it("creates, reads, updates, and deletes chat settings", () => {
    const original = repositories.chatSettings.getByChatId(-1001234567890);
    expect(original).toMatchObject({
      chatId: -1001234567890,
      generalTopicId: 1,
      chatTopicId: 42,
      timezone: "Europe/Minsk",
      defaultThreshold: 10,
    });

    const updated = repositories.chatSettings.upsert({
      chatId: -1001234567890,
      generalTopicId: 1,
      chatTopicId: 84,
      timezone: "UTC",
      defaultThreshold: 7,
    });
    expect(updated.chatTopicId).toBe(84);
    expect(updated.defaultThreshold).toBe(7);
    expect(repositories.chatSettings.update(-1001234567890, { timezone: "Europe/Moscow" }))
      .toMatchObject({ timezone: "Europe/Moscow" });

    expect(repositories.chatSettings.delete(-1001234567890)).toBe(true);
    expect(repositories.chatSettings.findByChatId(-1001234567890)).toBeUndefined();
  });

  it("stores one public card and one admin panel per match", () => {
    const firstMatch = repositories.matches.create({
      chatId: -1001234567890,
      scheduledAt: new Date("2026-08-01T17:00:00.000Z"),
      location: "Synthetic Stadium",
      requiredPlayers: 10,
      creatorTelegramUserId: 101,
    });
    const secondMatch = repositories.matches.create({
      chatId: -1001234567890,
      scheduledAt: new Date("2026-08-08T17:00:00.000Z"),
      location: "Synthetic Stadium",
      requiredPlayers: 8,
      creatorTelegramUserId: 102,
    });

    const publicCard = repositories.matchMessages.upsert({
      messageId: 1001,
      chatId: -1001234567890,
      topicId: 1,
      matchId: firstMatch.id,
      kind: "public_card",
    });
    const adminPanel = repositories.matchMessages.upsert({
      messageId: 1002,
      chatId: 101,
      topicId: null,
      matchId: firstMatch.id,
      kind: "admin_panel",
    });

    expect(repositories.matchMessages.findByMatchIdAndKind(firstMatch.id, "public_card")).toMatchObject({
      matchId: firstMatch.id,
      messageId: publicCard.messageId,
    });
    expect(repositories.matchMessages.findByChatAndMessageId(101, adminPanel.messageId, "admin_panel"))
      .toMatchObject({ matchId: firstMatch.id, kind: "admin_panel" });

    const updated = repositories.matchMessages.upsert({
      messageId: 1003,
      chatId: -1001234567890,
      topicId: 1,
      matchId: firstMatch.id,
      kind: "public_card",
    });
    expect(updated.id).toBe(publicCard.id);
    expect(repositories.matchMessages.findByMatchIdAndKind(firstMatch.id, "public_card"))
      .toMatchObject({ messageId: 1003 });
    expect(repositories.matchMessages.findByMatchIdAndKind(secondMatch.id, "public_card")).toBeUndefined();
  });

  it("claims callback updates exactly once", () => {
    const match = repositories.matches.create({
      chatId: -1001234567890,
      scheduledAt: new Date("2026-08-01T17:00:00.000Z"),
      location: "Synthetic Stadium",
      requiredPlayers: 3,
      creatorTelegramUserId: 101,
      status: "active",
    });

    expect(repositories.processedUpdates.claim({
      updateId: 77,
      matchId: match.id,
      action: "vote:going",
      telegramUserId: 555,
    })).toBeDefined();
    expect(repositories.processedUpdates.claim({
      updateId: 77,
      matchId: match.id,
      action: "vote:going",
      telegramUserId: 555,
    })).toBeUndefined();
    expect(repositories.processedUpdates.findByUpdateId(77)).toMatchObject({
      matchId: match.id,
      action: "vote:going",
    });
  });

  it("applies a vote and its callback claim atomically", () => {
    const match = repositories.matches.create({
      chatId: -1001234567890,
      scheduledAt: new Date("2026-08-01T17:00:00.000Z"),
      location: "Synthetic Stadium",
      requiredPlayers: 3,
      creatorTelegramUserId: 101,
      status: "active",
    });

    const input = {
      updateId: 88,
      matchId: match.id,
      telegramUserId: 555,
      usernameSnapshot: "synthetic_user",
      displayNameSnapshot: "Synthetic User",
      option: "going" as const,
    };
    const first = repositories.matchActions.applyVote(input);
    const duplicate = repositories.matchActions.applyVote(input);

    expect(first).toMatchObject({ status: "applied", goingCountAfter: 1 });
    expect(duplicate).toEqual({ status: "duplicate", processedMatchId: match.id });
    expect(repositories.votes.listByMatchId(match.id)).toHaveLength(1);
    expect(repositories.processedUpdates.findByUpdateId(88)).toBeDefined();
  });

  it("upserts a vote by match and Telegram user", () => {
    const match = repositories.matches.create({
      chatId: -1001234567890,
      scheduledAt: new Date("2026-08-01T17:00:00.000Z"),
      location: "Synthetic Stadium",
      requiredPlayers: 3,
      creatorTelegramUserId: 101,
    });

    repositories.votes.upsert({
      matchId: match.id,
      telegramUserId: 555,
      usernameSnapshot: "synthetic_user",
      displayNameSnapshot: "Synthetic User",
      option: "going",
    });
    const updated = repositories.votes.upsert({
      matchId: match.id,
      telegramUserId: 555,
      usernameSnapshot: null,
      displayNameSnapshot: "Synthetic User Updated",
      option: "maybe",
    });

    expect(repositories.votes.listByMatchId(match.id)).toHaveLength(1);
    expect(updated).toMatchObject({
      matchId: match.id,
      telegramUserId: 555,
      usernameSnapshot: null,
      displayNameSnapshot: "Synthetic User Updated",
      option: "maybe",
    });
    expect(repositories.votes.countGoing(match.id)).toBe(0);
    expect(repositories.votes.delete(match.id, 555)).toBe(true);
    expect(repositories.votes.find(match.id, 555)).toBeUndefined();
  });

  it("stores each external player command once", () => {
    const match = repositories.matches.create({
      chatId: -1001234567890,
      scheduledAt: new Date("2026-08-01T17:00:00.000Z"),
      location: "Synthetic Stadium",
      requiredPlayers: 3,
      creatorTelegramUserId: 101,
    });

    const first = repositories.externalParticipants.add({
      matchId: match.id,
      addedByTelegramUserId: 555,
      sourceUpdateId: 700,
      quantity: 1,
    });
    const duplicate = repositories.externalParticipants.add({
      matchId: match.id,
      addedByTelegramUserId: 555,
      sourceUpdateId: 700,
    });

    expect(first).toMatchObject({
      matchId: match.id,
      addedByTelegramUserId: 555,
      sourceUpdateId: 700,
    });
    expect(duplicate).toBeUndefined();
    expect(repositories.externalParticipants.countByMatchId(match.id)).toBe(1);

    const removed = repositories.externalParticipants.add({
      matchId: match.id,
      addedByTelegramUserId: 555,
      sourceUpdateId: 701,
      quantity: -1,
    });
    expect(removed).toMatchObject({ quantity: -1 });
    expect(repositories.externalParticipants.countByMatchId(match.id)).toBe(0);
  });

  it("enforces notification idempotency for a transition key", () => {
    const match = repositories.matches.create({
      chatId: -1001234567890,
      scheduledAt: new Date("2026-08-01T17:00:00.000Z"),
      location: "Synthetic Stadium",
      requiredPlayers: 3,
      creatorTelegramUserId: 101,
    });
    const input = {
      matchId: match.id,
      notificationType: "threshold_reached" as const,
      transitionKey: "going-count-3",
    };

    expect(repositories.notifications.claim(input)).toBeDefined();
    expect(repositories.notifications.claim(input)).toBeUndefined();
    expect(repositories.notifications.has(input)).toBe(true);
    expect(repositories.notifications.listByMatchId(match.id)).toHaveLength(1);
    expect(
      repositories.notifications.claim({
        ...input,
        transitionKey: "going-count-4",
      }),
    ).toBeDefined();
  });
});
