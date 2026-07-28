import type { Match, Vote } from "../../src/db/schema.js";
import {
  adminPanelContent,
  callbackData,
  matchCardContent,
  parseMatchAction,
} from "../../src/application/match-card.js";
import { renderMatchCard } from "../../src/domain/match-card.js";
import { describe, expect, it } from "vitest";

const match = {
  id: 32,
  chatId: -100,
  scheduledAt: new Date("2026-07-27T17:00:00.000Z"),
  location: "BOX365 <main>",
  fieldPriceRubles: 100,
  title: "27.07.2026 20:00 — BOX365 <main>",
  requiredPlayers: 3,
  status: "active",
  creatorTelegramUserId: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Match;

function vote(userId: number, option: Vote["option"], name: string, username?: string): Vote {
  return {
    matchId: match.id,
    telegramUserId: userId,
    usernameSnapshot: username ?? null,
    displayNameSnapshot: name,
    option,
    updatedAt: new Date(),
  };
}

describe("match card", () => {
  it("renders escaped grouped participant names and active buttons", () => {
    const content = matchCardContent(
      match,
      [
        vote(1, "going", "Иван <важный>", "ivan"),
        vote(2, "maybe", "Пётр & Саша"),
        vote(3, "not_going", "Мария"),
      ],
      1,
    );

    expect(content.text).toContain("Иван &lt;важный&gt; (@ivan)");
    expect(content.text).toContain("Пётр &amp; Саша");
    expect(content.text).toContain('tg://user?id=2');
    expect(content.text).toContain("Подтверждено: <b>2/3</b>");
    expect(content.replyMarkup?.inline_keyboard[0]).toHaveLength(3);
  });

  it("removes the keyboard for a cancelled match", () => {
    const content = matchCardContent({ ...match, status: "cancelled" }, [], 0);

    expect(content.text).toContain("Отменён");
    expect(content.replyMarkup).toBeUndefined();
  });

  it("keeps voting open after the match is confirmed and changes admin controls", () => {
    const content = matchCardContent({ ...match, status: "confirmed" }, [], 0);
    const admin = adminPanelContent({ ...match, status: "confirmed" });

    expect(content.text).toContain("Матч состоится");
    expect(content.replyMarkup?.inline_keyboard[0]).toHaveLength(3);
    expect(admin.text).toContain("Матч подтверждён");
    expect(admin.replyMarkup?.inline_keyboard[0]?.map((button) => button.text)).toEqual([
      "✅ Завершить",
      "🚫 Отменить",
    ]);
  });

  it("parses and serializes compact callback actions", () => {
    const action = { kind: "vote" as const, matchId: 32, option: "going" as const };
    expect(callbackData(action)).toBe("vote:32:going");
    expect(parseMatchAction("vote:32:going")).toEqual(action);
    expect(parseMatchAction("match:32:cancel")).toEqual({ kind: "cancel", matchId: 32 });
    expect(parseMatchAction("vote:0:going")).toBeUndefined();
    expect(parseMatchAction("unknown:32:going")).toBeUndefined();
  });

  it("keeps the output within Telegram's message budget without breaking HTML", () => {
    const votes = Array.from({ length: 200 }, (_, index) =>
      vote(index + 1, "going", `Player ${index + 1}`),
    );

    const card = renderMatchCard({ match, votes, externalCount: 0 });

    expect(card.text.length).toBeLessThan(4096);
    expect(card.text).toContain("ещё");
  });
});
