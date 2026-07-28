import {
  parseRemoveVoteCommand,
  REMOVE_VOTE_USAGE,
} from "../../src/application/vote-removal.js";
import { describe, expect, it } from "vitest";

describe("remove vote command", () => {
  it("parses a username target and normalizes it", () => {
    expect(parseRemoveVoteCommand("/remove_vote #v32 @Player_Name")).toEqual({
      matchId: 32,
      target: { kind: "username", username: "player_name" },
    });
  });

  it("parses a Telegram ID and an optional bot mention", () => {
    expect(parseRemoveVoteCommand("/remove_vote@football_bot v32 123456789")).toEqual({
      matchId: 32,
      target: { kind: "telegram_user_id", telegramUserId: 123456789 },
    });
  });

  it("rejects malformed commands and unsafe IDs", () => {
    expect(parseRemoveVoteCommand("/remove_vote #v0 @player_name")).toBeUndefined();
    expect(parseRemoveVoteCommand("/remove_vote #v32 player_name")).toBeUndefined();
    expect(parseRemoveVoteCommand("/remove_vote #v32 0")).toBeUndefined();
    expect(parseRemoveVoteCommand("/remove_vote #v32 9007199254740992")).toBeUndefined();
    expect(parseRemoveVoteCommand("/remove_vote #v32 @abc")).toBeUndefined();
  });

  it("exports a usage hint for invalid input", () => {
    expect(REMOVE_VOTE_USAGE).toContain("/remove_vote #v32 @username");
  });
});
