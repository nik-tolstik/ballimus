import type { Match, Vote } from "../../src/db/schema.js";
import { MatchInfoService, formatMatchInfo, parseMatchInfoMatchId } from "../../src/application/match-info.js";
import { describe, expect, it } from "vitest";

const match = {
  id: 2,
  chatId: -100,
  scheduledAt: new Date("2026-07-27T17:00:00.000Z"),
  location: "Ракета",
  requiredPlayers: 5,
  status: "active",
  creatorTelegramUserId: 7,
  createdAt: new Date("2026-07-26T00:00:00.000Z"),
  updatedAt: new Date("2026-07-26T00:00:00.000Z"),
} as Match;

const votes = [
  {
    matchId: 2,
    telegramUserId: 11,
    usernameSnapshot: "ivan",
    displayNameSnapshot: "Иван",
    option: "going",
    updatedAt: new Date(),
  },
  {
    matchId: 2,
    telegramUserId: 12,
    usernameSnapshot: null,
    displayNameSnapshot: "Анна",
    option: "not_going",
    updatedAt: new Date(),
  },
  {
    matchId: 2,
    telegramUserId: 13,
    usernameSnapshot: "oleg",
    displayNameSnapshot: "Олег",
    option: "maybe",
    updatedAt: new Date(),
  },
] as Vote[];

describe("match info", () => {
  it("parses an optional match reference", () => {
    expect(parseMatchInfoMatchId("/matchinfo")).toBeUndefined();
    expect(parseMatchInfoMatchId("/matchinfo #v32")).toBe(32);
    expect(parseMatchInfoMatchId("/matchinfo v32")).toBe(32);
    expect(parseMatchInfoMatchId("/matchinfo 32")).toBe(32);
    expect(parseMatchInfoMatchId("/matchinfo #v0")).toBeNull();
  });

  it("loads and formats current votes and external players", () => {
    const service = new MatchInfoService({
      matches: {
        findById: (matchId) => (matchId === match.id ? match : undefined),
        listByStatus: (chatId, status) =>
          chatId === match.chatId && status === match.status ? [match] : [],
      },
      votes: { listByMatchId: () => votes },
      externalParticipants: { countByMatchId: () => 2 },
    });

    const result = service.get({ chatId: match.chatId, matchId: match.id });

    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(formatMatchInfo(result, "Europe/Minsk")).toBe(
      "⚽ Матч #v2\n" +
        "Дата: 27.07.2026 20:00\n" +
       "Место: Ракета\n" +
        "Цена поля: не указана\n" +
        "Статус: Голосование открыто\n" +
        "Участники: 3/5\n" +
        "Дополнительные игроки: 2\n\n" +
        "Буду (1):\n" +
        "- Иван (@ivan)\n" +
        "Не смогу (1):\n" +
        "- Анна (ID 12)\n" +
        "Под вопросом (1):\n" +
        "- Олег (@oleg)",
    );
  });

  it("rejects a match from another configured chat", () => {
    const service = new MatchInfoService({
      matches: {
        findById: () => match,
        listByStatus: () => [],
      },
      votes: { listByMatchId: () => [] },
      externalParticipants: { countByMatchId: () => 0 },
    });

    expect(service.get({ chatId: -200, matchId: match.id })).toEqual({
      status: "not_found",
      reason: "match_not_found",
    });
  });
});
