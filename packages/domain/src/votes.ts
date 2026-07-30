import {
  type MatchId,
  type RosterCounts,
  type Vote,
  type VoteChoice,
} from "./types.js";
import { DomainValidationError, isVoteOption } from "./validation.js";

export interface ThresholdTransitionInput {
  readonly countBefore: number;
  readonly countAfter: number;
  readonly threshold: number;
  readonly eventKey: string;
}

export interface ThresholdTransitionResult {
  readonly thresholdReached: boolean;
  readonly thresholdLost: boolean;
  readonly thresholdReachedNotificationKey?: string;
  readonly thresholdLostNotificationKey?: string;
}

export interface VoteTransitionInput {
  readonly previousOption: VoteChoice;
  readonly nextOption: VoteChoice;
  /** Includes external participants when the caller is evaluating a full roster. */
  readonly goingCountBefore: number;
  readonly threshold: number;
  readonly eventKey: string;
}

export interface VoteTransitionResult extends ThresholdTransitionResult {
  readonly goingCountAfter: number;
}

export interface RosterCountInput {
  readonly requiredPlayers: number;
  readonly votes: readonly Vote[];
  readonly externalParticipants?: readonly { readonly quantity: number }[];
  readonly matchId?: MatchId;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertThreshold(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("threshold must be a positive safe integer");
  }
}

function assertEventKey(value: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error("eventKey must not be empty");
}

function assertVoteChoice(value: VoteChoice, name: string): void {
  if (value !== null && !isVoteOption(value)) throw new Error(`${name} is not a supported vote option`);
}

function sameId(left: MatchId, right: MatchId): boolean {
  return left === right || String(left) === String(right);
}

/** Counts only `going` votes; it never treats the threshold as a capacity. */
export function countGoingVotes(votes: readonly Vote[], matchId?: MatchId): number {
  let count = 0;
  for (const vote of votes) {
    if (matchId !== undefined && !sameId(vote.matchId, matchId)) continue;
    if (!isVoteOption(vote.option)) throw new Error("vote contains an unsupported option");
    if (vote.option === "going") count += 1;
  }
  return count;
}

/** Sums the owner-managed quantity ledger. Negative entries remove quantities. */
export function countExternalParticipants(
  participants: readonly { readonly quantity: number }[],
  matchId?: MatchId,
): number {
  let count = 0;
  for (const participant of participants) {
    if (matchId !== undefined && "matchId" in participant) {
      const candidate = participant as { readonly matchId?: MatchId };
      if (candidate.matchId !== undefined && !sameId(candidate.matchId, matchId)) continue;
    }
    if (!Number.isSafeInteger(participant.quantity) || participant.quantity === 0) {
      throw new Error("external participant quantity must be a non-zero safe integer");
    }
    count += participant.quantity;
  }
  if (count < 0) throw new Error("external participant total cannot be negative");
  return count;
}

export function calculateRosterCounts(input: RosterCountInput): RosterCounts {
  assertThreshold(input.requiredPlayers);
  const goingVotes = countGoingVotes(input.votes, input.matchId);
  const externalParticipants = countExternalParticipants(input.externalParticipants ?? [], input.matchId);
  const goingCount = goingVotes + externalParticipants;
  return {
    goingVotes,
    externalParticipants,
    goingCount,
    requiredPlayers: input.requiredPlayers,
    thresholdReached: goingCount >= input.requiredPlayers,
    remainingToThreshold: Math.max(0, input.requiredPlayers - goingCount),
  };
}

/** Calculates a minimum-player threshold crossing. Keys are safe for idempotent persistence. */
export function evaluateThresholdTransition(
  input: ThresholdTransitionInput,
): ThresholdTransitionResult {
  assertNonNegativeInteger(input.countBefore, "countBefore");
  assertNonNegativeInteger(input.countAfter, "countAfter");
  assertThreshold(input.threshold);
  assertEventKey(input.eventKey);

  const thresholdReached = input.countBefore < input.threshold && input.countAfter >= input.threshold;
  const thresholdLost = input.countBefore >= input.threshold && input.countAfter < input.threshold;
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

/** Calculates one editable vote change against the full roster count. */
export function evaluateVoteTransition(input: VoteTransitionInput): VoteTransitionResult {
  assertNonNegativeInteger(input.goingCountBefore, "goingCountBefore");
  assertVoteChoice(input.previousOption, "previousOption");
  assertVoteChoice(input.nextOption, "nextOption");

  const previousGoing = input.previousOption === "going" ? 1 : 0;
  const nextGoing = input.nextOption === "going" ? 1 : 0;
  const goingCountAfter = input.goingCountBefore - previousGoing + nextGoing;
  if (goingCountAfter < 0) throw new Error("goingCountBefore is inconsistent with the previous vote");

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

export interface ExternalQuantityTransitionInput {
  readonly externalCountBefore: number;
  readonly sourceCountBefore: number;
  readonly goingVotes: number;
  readonly quantity: number;
  readonly threshold: number;
  readonly eventKey: string;
}

export interface ExternalQuantityTransitionResult extends ThresholdTransitionResult {
  readonly externalCountAfter: number;
  readonly goingCountBefore: number;
  readonly goingCountAfter: number;
}

/** Applies an owner-managed external quantity delta without imposing a roster capacity. */
export function evaluateExternalQuantityTransition(
  input: ExternalQuantityTransitionInput,
): ExternalQuantityTransitionResult {
  assertNonNegativeInteger(input.externalCountBefore, "externalCountBefore");
  assertNonNegativeInteger(input.sourceCountBefore, "sourceCountBefore");
  assertNonNegativeInteger(input.goingVotes, "goingVotes");
  if (!Number.isSafeInteger(input.quantity) || input.quantity === 0) {
    throw new Error("quantity must be a non-zero safe integer");
  }
  if (input.quantity < 0 && Math.abs(input.quantity) > input.sourceCountBefore) {
    throw new Error("quantity cannot remove more participants than the source contains");
  }
  const externalCountAfter = input.externalCountBefore + input.quantity;
  if (externalCountAfter < 0) throw new Error("external participant total cannot be negative");
  const goingCountBefore = input.goingVotes + input.externalCountBefore;
  const goingCountAfter = input.goingVotes + externalCountAfter;
  return {
    externalCountAfter,
    goingCountBefore,
    goingCountAfter,
    ...evaluateThresholdTransition({
      countBefore: goingCountBefore,
      countAfter: goingCountAfter,
      threshold: input.threshold,
      eventKey: input.eventKey,
    }),
  };
}

export function assertValidVoteTransitionInput(input: VoteTransitionInput): void {
  try {
    evaluateVoteTransition(input);
  } catch (error) {
    const issue = {
      path: "voteTransition",
      code: "invalid_value" as const,
      message: error instanceof Error ? error.message : String(error),
    };
    throw new DomainValidationError([issue]);
  }
}
