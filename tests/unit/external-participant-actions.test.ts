import {
  externalParticipantCallbackData,
  externalParticipantMenuContent,
  parseExternalParticipantAction,
} from "../../src/application/external-participant-actions.js";
import { describe, expect, it } from "vitest";

describe("external participant callback actions", () => {
  it("serializes and parses menu, add, and remove actions", () => {
    for (const kind of ["menu", "add", "remove"] as const) {
      const data = externalParticipantCallbackData({ kind, matchId: 32 });
      expect(data).toBe(`external:32:${kind}`);
      expect(parseExternalParticipantAction(data)).toEqual({ kind, matchId: 32 });
    }
  });

  it("rejects malformed callback data", () => {
    expect(parseExternalParticipantAction("external:0:add")).toBeUndefined();
    expect(parseExternalParticipantAction("external:32:unknown")).toBeUndefined();
    expect(parseExternalParticipantAction("external:32:add:extra")).toBeUndefined();
    expect(parseExternalParticipantAction("match:32:add")).toBeUndefined();
  });

  it("builds the private menu with one-player controls", () => {
    const content = externalParticipantMenuContent(32, 2);

    expect(content.text).toBe("Дополнительные игроки для матча #v32\nВы добавили: 2");
    expect(content.replyMarkup.inline_keyboard).toEqual([[
      { text: "➕ Добавить игрока", callback_data: "external:32:add" },
      { text: "➖ Убрать игрока", callback_data: "external:32:remove" },
    ]]);
  });
});
