import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createMatchEditingService,
} from "../../src/application/match-editing.js";
import { createTestDatabase, type DatabaseClient } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import type { MatchDraft } from "../../src/parser/match-parser.js";

const CHAT_ID = -1001234567890;
const CREATOR_ID = 101;

const exactDraft: MatchDraft = {
  date: "2026-08-03",
  time: "20:00",
  location: "Ракета",
  venueType: "outdoor",
  requiredPlayers: 10,
  fieldPriceRubles: 100,
};

describe("published match editing persistence", () => {
  let client: DatabaseClient;
  let repositories: Repositories;

  beforeEach(() => {
    client = createTestDatabase();
    repositories = createRepositories(client.db);
    repositories.chatSettings.create({
      chatId: CHAT_ID,
      generalTopicId: 1,
      chatTopicId: 42,
      timezone: "Europe/Minsk",
      defaultThreshold: 10,
    });
  });

  afterEach(() => {
    client.close();
  });

  function service(authorized = true) {
    return createMatchEditingService({
      repositories: {
        matches: repositories.matches,
        matchActions: repositories.matchActions,
      },
      authorizeCreator: () => authorized,
    });
  }

  it("replaces approximate details on the same active match without losing its roster", async () => {
    const match = repositories.matches.create({
      chatId: CHAT_ID,
      scheduledAt: null,
      location: null,
      venueType: null,
      fieldPriceRubles: null,
      title: "Четверг около 20:00",
      requiredPlayers: 8,
      creatorTelegramUserId: CREATOR_ID,
      status: "active",
    });
    repositories.votes.upsert({
      matchId: match.id,
      telegramUserId: 501,
      usernameSnapshot: "ivan",
      displayNameSnapshot: "Ivan",
      option: "going",
    });
    repositories.externalParticipants.add({
      matchId: match.id,
      addedByTelegramUserId: CREATOR_ID,
      sourceUpdateId: 700,
      sourceLabel: "Никиты",
      quantity: 3,
    });

    const result = await service().edit({
      updateId: 900,
      chatId: CHAT_ID,
      matchId: match.id,
      editorTelegramUserId: CREATOR_ID,
      timezone: "Europe/Minsk",
      draft: exactDraft,
    });

    expect(result).toMatchObject({
      status: "updated",
      match: {
        id: match.id,
        status: "active",
        location: "Ракета",
        venueType: "outdoor",
        fieldPriceRubles: 100,
        requiredPlayers: 10,
        title: "03.08.2026 20:00 (Ракета, 100 рублей)",
      },
    });

    const saved = repositories.matches.findById(match.id);
    expect(saved?.scheduledAt?.toISOString()).toBe("2026-08-03T17:00:00.000Z");
    expect(repositories.votes.listByMatchId(match.id)).toEqual([
      expect.objectContaining({ telegramUserId: 501, option: "going" }),
    ]);
    expect(repositories.externalParticipants.countByMatchId(match.id)).toBe(3);
    expect(repositories.processedUpdates.findByUpdateId(900)).toMatchObject({
      matchId: match.id,
      action: "match:edit",
    });

    const duplicate = await service().edit({
      updateId: 900,
      chatId: CHAT_ID,
      matchId: match.id,
      editorTelegramUserId: CREATOR_ID,
      timezone: "Europe/Minsk",
      draft: { ...exactDraft, location: "Другой стадион", requiredPlayers: 12 },
    });

    expect(duplicate).toEqual({ status: "duplicate", answer: "Это редактирование уже обработано" });
    expect(repositories.matches.findById(match.id)).toMatchObject({
      location: "Ракета",
      requiredPlayers: 10,
    });
  });

  it("keeps a confirmed match confirmed and rejects terminal or non-creator edits", async () => {
    const confirmed = repositories.matches.create({
      chatId: CHAT_ID,
      scheduledAt: null,
      location: null,
      venueType: null,
      requiredPlayers: 8,
      creatorTelegramUserId: CREATOR_ID,
      status: "confirmed",
    });
    const completed = repositories.matches.create({
      chatId: CHAT_ID,
      scheduledAt: null,
      location: null,
      venueType: null,
      requiredPlayers: 8,
      creatorTelegramUserId: CREATOR_ID,
      status: "completed",
    });

    const confirmedResult = await service().edit({
      updateId: 901,
      chatId: CHAT_ID,
      matchId: confirmed.id,
      editorTelegramUserId: CREATOR_ID,
      timezone: "Europe/Minsk",
      draft: exactDraft,
    });
    const terminalResult = await service().edit({
      updateId: 902,
      chatId: CHAT_ID,
      matchId: completed.id,
      editorTelegramUserId: CREATOR_ID,
      timezone: "Europe/Minsk",
      draft: exactDraft,
    });
    const nonCreatorResult = await service().edit({
      updateId: 903,
      chatId: CHAT_ID,
      matchId: confirmed.id,
      editorTelegramUserId: 502,
      timezone: "Europe/Minsk",
      draft: exactDraft,
    });

    expect(confirmedResult).toMatchObject({
      status: "updated",
      match: { id: confirmed.id, status: "confirmed" },
    });
    expect(terminalResult).toEqual({
      status: "ignored",
      answer: "Матч завершён и больше не редактируется",
    });
    expect(nonCreatorResult).toEqual({
      status: "ignored",
      answer: "Редактировать матч может только его создатель",
    });
    expect(repositories.processedUpdates.findByUpdateId(902)).toBeUndefined();
    expect(repositories.processedUpdates.findByUpdateId(903)).toBeUndefined();
  });
});
