import { describe, expect, it } from "vitest";

import {
  matchEditPromptText,
  parseMatchEditCommand,
} from "../../src/application/match-editing.js";
import type { Match } from "../../src/db/schema.js";

const exactMatch: Match = {
  id: 42,
  chatId: -1001234567890,
  scheduledAt: new Date("2026-08-03T17:00:00.000Z"),
  location: "Ракета",
  venueType: "outdoor",
  fieldPriceRubles: 100,
  title: "03.08.2026 20:00 (Ракета, 100 рублей)",
  requiredPlayers: 10,
  status: "active",
  cancellationReason: null,
  creatorTelegramUserId: 101,
  createdAt: new Date("2026-07-28T00:00:00.000Z"),
  updatedAt: new Date("2026-07-28T00:00:00.000Z"),
};

describe("published match editing", () => {
  it("adapts a full /editmatch form for the existing canonical /match parser", () => {
    const command = [
      "/editmatch@football_bot #v42",
      "Дата: 03.08.2026",
      "Время: 20:00",
      "Место: Ракета",
      "Формат: на улице",
      "Нужно игроков: 10",
      "Цена поля: 100 рублей",
    ].join("\n");

    expect(parseMatchEditCommand(command)).toEqual({
      matchId: 42,
      matchCommand: command.replace(/^\/editmatch@football_bot #v42/u, "/match"),
    });
  });

  it("builds a copyable full-replacement form and marks unknown details for completion", () => {
    expect(matchEditPromptText(exactMatch, "Europe/Minsk")).toBe(
      [
        "Редактирование матча #v42",
        "Скопируйте шаблон, внесите изменения и отправьте его боту одним сообщением:",
        "",
        "/editmatch #v42",
        "Дата: 03.08.2026",
        "Время: 20:00",
        "Место: Ракета",
        "Формат: на улице",
        "Нужно игроков: 10",
        "Цена поля: 100 рублей",
      ].join("\n"),
    );

    const approximateWithoutPlace: Match = {
      ...exactMatch,
      scheduledAt: null,
      location: null,
      venueType: null,
      fieldPriceRubles: null,
      title: "Четверг около 20:00",
    };
    const prompt = matchEditPromptText(approximateWithoutPlace, "Europe/Minsk");

    expect(prompt).toContain("Дата: укажите");
    expect(prompt).toContain("Время: укажите");
    expect(prompt).toContain("Место: \n");
    expect(prompt).toContain("Формат: укажите");
    expect(prompt).not.toContain("Цена поля:");
  });
});
