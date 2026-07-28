export const voteOptions = ["going", "not_going", "maybe"] as const;
export type VoteOption = (typeof voteOptions)[number];
export type VoteChoice = VoteOption | null;

export interface ThresholdTransitionInput {
  countBefore: number;
  countAfter: number;
  threshold: number;
  eventKey: string;
}

export interface ThresholdTransitionResult {
  thresholdReached: boolean;
  thresholdLost: boolean;
  thresholdReachedNotificationKey?: string;
  thresholdLostNotificationKey?: string;
}

export interface VoteTransitionInput {
  previousOption: VoteChoice;
  nextOption: VoteChoice;
  goingCountBefore: number;
  threshold: number;
  eventKey: string;
}

export interface VoteTransitionResult extends ThresholdTransitionResult {
  goingCountAfter: number;
}

function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertTransitionInput(input: ThresholdTransitionInput): void {
  assertCount(input.countBefore, "countBefore");
  assertCount(input.countAfter, "countAfter");
  if (!Number.isInteger(input.threshold) || input.threshold < 1) {
    throw new Error("threshold must be a positive integer");
  }
  if (input.eventKey.trim() === "") {
    throw new Error("eventKey must not be empty");
  }
}

/**
 * Calculates a minimum-player threshold crossing. Notification keys are tied
 * to the Telegram update, so a redelivered update cannot announce twice.
 */
export function evaluateThresholdTransition(
  input: ThresholdTransitionInput,
): ThresholdTransitionResult {
  assertTransitionInput(input);

  const thresholdReached =
    input.countBefore < input.threshold && input.countAfter >= input.threshold;
  const thresholdLost =
    input.countBefore >= input.threshold && input.countAfter < input.threshold;

  return {
    thresholdReached,
    thresholdLost,
    ...(thresholdReached
      ? { thresholdReachedNotificationKey: `threshold:reached:${input.eventKey}` }
      : {}),
    ...(thresholdLost
      ? { thresholdLostNotificationKey: `threshold:lost:${input.eventKey}` }
      : {}),
  };
}

/** Calculates vote effects without talking to Telegram or a database. */
export function evaluateVoteTransition(input: VoteTransitionInput): VoteTransitionResult {
  assertCount(input.goingCountBefore, "goingCountBefore");

  const previousGoing = input.previousOption === "going" ? 1 : 0;
  const nextGoing = input.nextOption === "going" ? 1 : 0;
  const goingCountAfter = input.goingCountBefore - previousGoing + nextGoing;

  if (goingCountAfter < 0) {
    throw new Error("goingCountBefore is inconsistent with the previous vote");
  }

  return {
    goingCountAfter,
    ...evaluateThresholdTransition({
      countBefore: input.goingCountBefore,
      countAfter: goingCountAfter,
      threshold: input.threshold,
      eventKey: input.eventKey,
    }),
  };
}
