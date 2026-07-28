export const voteOptions = ["going", "not_going", "maybe"] as const;
export type VoteOption = (typeof voteOptions)[number];
export type VoteChoice = VoteOption | null;

export interface VoteTransitionInput {
  previousOption: VoteChoice;
  nextOption: VoteChoice;
  goingCountBefore: number;
  threshold: number;
  thresholdWasReached: boolean;
  eventKey: string;
  telegramUserId: number;
}

export interface VoteTransitionResult {
  goingCountAfter: number;
  thresholdWasReachedAfter: boolean;
  thresholdCrossed: boolean;
  withdrewFromGoing: boolean;
  thresholdNotificationKey?: string;
  withdrawalNotificationKey?: string;
}

function assertInput(input: VoteTransitionInput): void {
  if (!Number.isInteger(input.goingCountBefore) || input.goingCountBefore < 0) {
    throw new Error("goingCountBefore must be a non-negative integer");
  }
  if (!Number.isInteger(input.threshold) || input.threshold < 1) {
    throw new Error("threshold must be a positive integer");
  }
  if (input.eventKey.trim() === "") {
    throw new Error("eventKey must not be empty");
  }
  if (!Number.isSafeInteger(input.telegramUserId)) {
    throw new Error("telegramUserId must be a safe integer");
  }
}

/**
 * Calculates the effects of one match vote without talking to Telegram or a database.
 * The event key must be stable for duplicate Telegram deliveries and unique per update.
 */
export function evaluateVoteTransition(input: VoteTransitionInput): VoteTransitionResult {
  assertInput(input);

  const previousGoing = input.previousOption === "going" ? 1 : 0;
  const nextGoing = input.nextOption === "going" ? 1 : 0;
  const goingCountAfter = input.goingCountBefore - previousGoing + nextGoing;

  if (goingCountAfter < 0) {
    throw new Error("goingCountBefore is inconsistent with the previous vote");
  }

  const thresholdCrossed =
    input.goingCountBefore < input.threshold && goingCountAfter >= input.threshold;
  const withdrewFromGoing =
    input.thresholdWasReached && input.previousOption === "going" && input.nextOption !== "going";

  return {
    goingCountAfter,
    thresholdWasReachedAfter: input.thresholdWasReached || thresholdCrossed,
    thresholdCrossed,
    withdrewFromGoing,
    ...(thresholdCrossed
      ? { thresholdNotificationKey: `threshold:${input.eventKey}` }
      : {}),
    ...(withdrewFromGoing
      ? { withdrawalNotificationKey: `withdrawal:${input.eventKey}:${input.telegramUserId}` }
      : {}),
  };
}
