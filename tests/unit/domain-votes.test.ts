import { describe, expect, it } from "vitest";

import { evaluateVoteTransition, type VoteChoice } from "../../src/domain/votes.js";

const choices: VoteChoice[] = [null, "going", "not_going", "maybe"];

describe("vote state transitions", () => {
  it.each(choices.flatMap((previous) => choices.map((next) => [previous, next] as const))) (
    "%s -> %s updates the going count correctly",
    (previous, next) => {
      const result = evaluateVoteTransition({
        previousOption: previous,
        nextOption: next,
        goingCountBefore: previous === "going" ? 1 : 0,
        threshold: 2,
        thresholdWasReached: false,
        eventKey: "update-1",
        telegramUserId: 123,
      });

      expect(result.goingCountAfter).toBe(next === "going" ? 1 : 0);
    },
  );

  it("detects an upward threshold crossing exactly once for the transition", () => {
    const result = evaluateVoteTransition({
      previousOption: null,
      nextOption: "going",
      goingCountBefore: 2,
      threshold: 3,
      thresholdWasReached: false,
      eventKey: "update-42",
      telegramUserId: 123,
    });

    expect(result.thresholdCrossed).toBe(true);
    expect(result.thresholdNotificationKey).toBe("threshold:update-42");
    expect(result.thresholdWasReachedAfter).toBe(true);
  });

  it("detects withdrawal after the threshold for a vote change and removal", () => {
    for (const nextOption of ["not_going", "maybe", null] as const) {
      const result = evaluateVoteTransition({
        previousOption: "going",
        nextOption,
        goingCountBefore: 3,
        threshold: 3,
        thresholdWasReached: true,
        eventKey: `update-${String(nextOption)}`,
        telegramUserId: 456,
      });

      expect(result.withdrewFromGoing).toBe(true);
      expect(result.goingCountAfter).toBe(2);
      expect(result.withdrawalNotificationKey).toContain("456");
    }
  });

  it("does not warn for non-going changes or before the threshold", () => {
    const nonGoingChange = evaluateVoteTransition({
      previousOption: "not_going",
      nextOption: "maybe",
      goingCountBefore: 2,
      threshold: 3,
      thresholdWasReached: true,
      eventKey: "update-1",
      telegramUserId: 789,
    });
    const beforeThreshold = evaluateVoteTransition({
      previousOption: "going",
      nextOption: "maybe",
      goingCountBefore: 1,
      threshold: 3,
      thresholdWasReached: false,
      eventKey: "update-2",
      telegramUserId: 789,
    });

    expect(nonGoingChange.withdrewFromGoing).toBe(false);
    expect(beforeThreshold.withdrewFromGoing).toBe(false);
  });
});
