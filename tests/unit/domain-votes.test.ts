import { describe, expect, it } from "vitest";

import {
  evaluateThresholdTransition,
  evaluateVoteTransition,
  type VoteChoice,
} from "../../src/domain/votes.js";

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
        eventKey: "update-1",
      });

      expect(result.goingCountAfter).toBe(next === "going" ? 1 : 0);
    },
  );

  it("detects an upward threshold crossing", () => {
    const result = evaluateThresholdTransition({
      countBefore: 2,
      countAfter: 3,
      threshold: 3,
      eventKey: "update-42",
    });

    expect(result).toEqual({
      thresholdReached: true,
      thresholdLost: false,
      thresholdReachedNotificationKey: "threshold:reached:update-42",
    });
  });

  it("detects a downward threshold crossing", () => {
    const result = evaluateThresholdTransition({
      countBefore: 3,
      countAfter: 2,
      threshold: 3,
      eventKey: "update-43",
    });

    expect(result).toEqual({
      thresholdReached: false,
      thresholdLost: true,
      thresholdLostNotificationKey: "threshold:lost:update-43",
    });
  });

  it("does not announce changes that stay on the same side of the threshold", () => {
    expect(evaluateThresholdTransition({
      countBefore: 4,
      countAfter: 3,
      threshold: 3,
      eventKey: "still-enough",
    })).toMatchObject({ thresholdReached: false, thresholdLost: false });
    expect(evaluateThresholdTransition({
      countBefore: 2,
      countAfter: 1,
      threshold: 3,
      eventKey: "still-not-enough",
    })).toMatchObject({ thresholdReached: false, thresholdLost: false });
  });

  it("does not announce a non-going vote change", () => {
    const result = evaluateVoteTransition({
      previousOption: "not_going",
      nextOption: "maybe",
      goingCountBefore: 2,
      threshold: 3,
      eventKey: "update-44",
    });

    expect(result).toMatchObject({
      goingCountAfter: 2,
      thresholdReached: false,
      thresholdLost: false,
    });
  });
});
