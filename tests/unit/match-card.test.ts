import type { ExternalParticipant, Match, Vote } from "../../src/db/schema.js";
import {
  adminPanelContent,
  callbackData,
  cancellationPromptContent,
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
  title: "27.07.2026 20:00 (BOX365 <main>, 100 рублей)",
  requiredPlayers: 3,
  status: "active",
  venueType: "outdoor",
  cancellationReason: null,
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
  it("renders the compact voting layout", () => {
    const content = matchCardContent(
      {
        ...match,
        id: 5,
        location: "Ракета",
        requiredPlayers: 10,
      },
      [
        { ...vote(1, "going", "Nikita Tolstik", "nikita_tolstik"), matchId: 5 },
        { ...vote(2, "going", "Ivan", "ivan"), matchId: 5 },
      ],
      0,
      [],
      {
        timezone: "Europe/Minsk",
        now: new Date("2026-07-27T12:00:00.000Z"),
      },
    );

    expect(content.text).toBe([
      "#v5",
      "Сегодня 20:00",
      "",
      "Статус: Голосуем",
      "",
      "📍 Место: Ракета",
      "🏠 Формат: на улице, 10-12 человек",
      "🫰 Сумма: 100 рублей",
      "",
      "<b>👯 Состав 2/10</b>",
      "",
      "<b>Участвуют (2)</b>",
      "1. Nikita Tolstik (@nikita_tolstik)",
      "2. Ivan (@ivan)",
      "",
      "Под вопросом (0)",
      "Не смогут (0)",
    ].join("\n"));
  });

  it("renders escaped grouped participant names and active buttons", () => {
    const content = matchCardContent(
      match,
      [
        vote(1, "going", "Иван <важный>", "ivan"),
        vote(2, "maybe", "Пётр & Саша"),
        vote(3, "not_going", "Мария"),
      ],
      1,
      [],
      {
        timezone: "Europe/Minsk",
        now: new Date("2026-07-26T12:00:00.000Z"),
      },
    );

    expect(content.text).toContain("#v32\n27.07.2026 20:00\n\n");
    expect(content.text).not.toContain("27.07.2026 20:00 (BOX365");
    expect(content.text).toContain("Иван &lt;важный&gt; (@ivan)");
    expect(content.text).toContain("Пётр &amp; Саша");
    expect(content.text).toContain('tg://user?id=2');
    expect(content.text).toContain("Статус: Голосуем");
    expect(content.text).toContain("📍 Место: BOX365 &lt;main&gt;");
    expect(content.text).toContain("🏠 Формат: на улице, 3-5 человек");
    expect(content.text).toContain("🫰 Сумма: 100 рублей");
    expect(content.text).toContain("<b>👯 Состав 2/3</b>");
    expect(content.text).toContain("Внешние игроки: 1");
    expect(content.text).toContain("<b>Участвуют (1)</b>");
    expect(content.text).toContain("1. Иван &lt;важный&gt; (@ivan)");
    expect(content.text).toContain("Под вопросом (1)");
    expect(content.text).toContain("Не смогут (1)");
    expect(content.replyMarkup?.inline_keyboard[0]?.map((button) => button.text)).toEqual([
      "Участвую",
      "Под вопросом",
      "Не смогу",
    ]);
    expect(content.replyMarkup?.inline_keyboard[1]).toEqual([{
      text: "Доп. игроки",
      callback_data: "external:32:menu",
    }]);
  });

  it("uses Today based on the Minsk calendar date at a UTC day boundary", () => {
    const content = matchCardContent({
      ...match,
      scheduledAt: new Date("2026-07-27T21:30:00.000Z"),
    }, [], 0, [], {
      timezone: "Europe/Minsk",
      now: new Date("2026-07-27T21:15:00.000Z"),
    });

    expect(content.text).toContain("Сегодня 00:30");
  });

  it("removes legacy details from an approximate schedule title", () => {
    const content = matchCardContent({
      ...match,
      scheduledAt: null,
      title: "Четверг 20:00-21:30 (BOX365 <main>, 100 рублей)",
    }, [], 0);

    expect(content.text).toContain("#v32\nЧетверг 20:00-21:30\n\n");
    expect(content.text).not.toContain("Четверг 20:00-21:30 (BOX365");
  });

  it("removes the keyboard for a cancelled match", () => {
    const content = matchCardContent({
      ...match,
      status: "cancelled",
      cancellationReason: "Плохая погода",
    }, [], 0);

    expect(content.text).toContain("Отменён");
    expect(content.text).toContain("Причина отмены: Плохая погода");
    expect(content.replyMarkup).toBeUndefined();
  });

  it("shows venue and attributed external-player totals", () => {
    const externalParticipants = [
      { id: 1, matchId: 32, addedByTelegramUserId: 7, sourceUpdateId: 1, sourceLabel: "Никиты", quantity: 3, createdAt: new Date() },
      { id: 2, matchId: 32, addedByTelegramUserId: 7, sourceUpdateId: 2, sourceLabel: "Никиты", quantity: -1, createdAt: new Date() },
      { id: 3, matchId: 32, addedByTelegramUserId: 7, sourceUpdateId: 3, sourceLabel: null, displayNameSnapshot: "Ваня", quantity: 1, createdAt: new Date() },
    ] as ExternalParticipant[];

    const content = matchCardContent(match, [], 3, externalParticipants);

    expect(content.text).toContain("🏠 Формат: на улице, 3-5 человек");
    expect(content.text).toContain("Внешние игроки: 3");
    expect(content.text).toContain("От Никиты: 2");
    expect(content.text).toContain("От Ваня: 1");
  });

  it("groups unnamed historical players by Telegram ID when no snapshot exists", () => {
    const content = matchCardContent(match, [], 2, [
      {
        id: 1,
        matchId: match.id,
        addedByTelegramUserId: 555,
        sourceUpdateId: 1,
        sourceLabel: null,
        displayNameSnapshot: null,
        quantity: 2,
        createdAt: new Date(),
      },
    ]);

    expect(content.text).toContain("От ID 555: 2");
  });

  it("prefers a later display snapshot for the same unnamed contributor", () => {
    const content = matchCardContent(match, [], 2, [
      {
        id: 1,
        matchId: match.id,
        addedByTelegramUserId: 555,
        sourceUpdateId: 1,
        sourceLabel: null,
        displayNameSnapshot: null,
        quantity: 1,
        createdAt: new Date(),
      },
      {
        id: 2,
        matchId: match.id,
        addedByTelegramUserId: 555,
        sourceUpdateId: 2,
        sourceLabel: null,
        displayNameSnapshot: "Ваня",
        quantity: 1,
        createdAt: new Date(),
      },
    ]);

    expect(content.text).toContain("От Ваня: 2");
    expect(content.text).not.toContain("От ID 555");
  });

  it("hides the external-player section when there are no external players", () => {
    const content = matchCardContent(match, [], 0);

    expect(content.text).not.toContain("Внешние игроки");
    expect(content.text).not.toContain("От Никиты");
  });

  it("keeps voting open after the match is confirmed and changes admin controls", () => {
    const content = matchCardContent({ ...match, status: "confirmed" }, [], 0);
    const activeAdmin = adminPanelContent(match);
    const admin = adminPanelContent({ ...match, status: "confirmed" });

    expect(content.text).toContain("Статус: <b>Матч состоится ✅</b>");
    expect(content.replyMarkup?.inline_keyboard[0]).toHaveLength(3);
    expect(admin.text).toContain("Матч подтверждён");
    expect(activeAdmin.replyMarkup?.inline_keyboard[0]?.map((button) => button.text)).toEqual([
      "Редактировать",
    ]);
    expect(activeAdmin.replyMarkup?.inline_keyboard[1]?.map((button) => button.text)).toEqual([
      "Матч будет",
      "Отменить",
    ]);
    expect(admin.replyMarkup?.inline_keyboard[0]?.map((button) => button.text)).toEqual([
      "Редактировать",
    ]);
    expect(admin.replyMarkup?.inline_keyboard[1]?.map((button) => button.text)).toEqual([
      "Завершить",
      "Отменить",
    ]);
  });

  it("parses and serializes compact callback actions", () => {
    const action = { kind: "vote" as const, matchId: 32, option: "going" as const };
    expect(callbackData(action)).toBe("vote:32:going");
    expect(parseMatchAction("vote:32:going")).toEqual(action);
    expect(parseMatchAction("match:32:cancel")).toEqual({ kind: "cancel", matchId: 32 });
    expect(parseMatchAction("match:32:edit")).toEqual({ kind: "edit", matchId: 32 });
    expect(parseMatchAction("match:32:cancel_bad_weather")).toEqual({
      kind: "cancel_bad_weather",
      matchId: 32,
    });
    expect(parseMatchAction("vote:0:going")).toBeUndefined();
    expect(parseMatchAction("unknown:32:going")).toBeUndefined();
  });

  it("offers the required cancellation reasons and can restore a cancelled panel", () => {
    const prompt = cancellationPromptContent(match);
    const cancelledPanel = adminPanelContent({
      ...match,
      status: "cancelled",
      cancellationReason: "Недостаточно игроков",
    });

    expect(prompt.replyMarkup?.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Недостаточно игроков",
      "Плохая погода",
      "Назад",
    ]);
    expect(cancelledPanel.text).toContain("Причина: Недостаточно игроков");
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
