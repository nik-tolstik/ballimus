import { describe, expect, it, vi } from "vitest";

import { MatchCardUpdater } from "../../src/application/match-card-updater.js";
import type { Match } from "../../src/db/schema.js";

const baseMatch = {
  id: 6,
  chatId: -100,
  scheduledAt: new Date("2026-07-28T17:00:00.000Z"),
  location: "Ракета",
  fieldPriceRubles: 100,
  title: "28.07.2026 20:00 (Ракета, 100 рублей)",
  requiredPlayers: 10,
  status: "active",
  venueType: "outdoor",
  cancellationReason: null,
  creatorTelegramUserId: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Match;

function fixture(match: Match, deleteError?: Error) {
  const edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  const deletions: Array<{ chatId: number; messageId: number }> = [];
  const updater = new MatchCardUpdater(
    {
      matches: { findById: (matchId) => (matchId === match.id ? match : undefined) },
      matchMessages: {
        findByMatchIdAndKind: (_matchId, kind) =>
          kind === "public_card"
            ? { chatId: -100, messageId: 10 }
            : { chatId: 7, messageId: 11 },
      },
      votes: { listByMatchId: () => [] },
      externalParticipants: { countByMatchId: () => 0 },
    },
    {
      editMessage: async (request) => {
        edits.push({ chatId: request.chatId, messageId: request.messageId, text: request.text });
      },
      deleteMessage: async (request) => {
        if (deleteError !== undefined) throw deleteError;
        deletions.push(request);
      },
    },
  );

  return { updater, edits, deletions };
}

describe("match card updater", () => {
  it("edits an open public card and the admin panel", async () => {
    const test = fixture(baseMatch);

    await test.updater.refresh(baseMatch.id);

    expect(test.deletions).toEqual([]);
    expect(test.edits).toHaveLength(2);
    expect(test.edits[0]).toMatchObject({ chatId: -100, messageId: 10 });
    expect(test.edits[0]?.text).toContain("Статус: Голосуем");
    expect(test.edits[1]).toMatchObject({ chatId: 7, messageId: 11 });
  });

  it("deletes a completed public card while retaining the final admin panel", async () => {
    const test = fixture({ ...baseMatch, status: "completed" });

    await test.updater.refresh(baseMatch.id);

    expect(test.deletions).toEqual([{ chatId: -100, messageId: 10 }]);
    expect(test.edits).toHaveLength(1);
    expect(test.edits[0]).toMatchObject({ chatId: 7, messageId: 11 });
    expect(test.edits[0]?.text).toContain("Матч завершён");
  });

  it("deletes a cancelled public card and falls back to a frozen card when deletion fails", async () => {
    const cancelled = {
      ...baseMatch,
      status: "cancelled" as const,
      cancellationReason: "Недостаточно игроков",
    };
    const test = fixture(cancelled, new Error("Telegram unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await test.updater.refresh(cancelled.id);
    } finally {
      error.mockRestore();
    }

    expect(test.deletions).toEqual([]);
    expect(test.edits).toHaveLength(2);
    expect(test.edits[0]).toMatchObject({ chatId: -100, messageId: 10 });
    expect(test.edits[0]?.text).toContain("Причина отмены: Недостаточно игроков");
    expect(test.edits[1]).toMatchObject({ chatId: 7, messageId: 11 });
  });
});
