import type { Match, MatchTimeMode, Vote } from "./types.js";

export const MIN_AVAILABILITY_TIME_OPTIONS = 2;
export const MAX_AVAILABILITY_TIME_OPTIONS = 6;

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && LOCAL_TIME_PATTERN.test(value);
}

export function matchTimeMode(match: Pick<Match, "timeMode">): MatchTimeMode {
  return match.timeMode ?? "exact";
}

export function normalizeAvailabilityTimeOptions(values: readonly string[]): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()))].sort();
  if (
    normalized.length < MIN_AVAILABILITY_TIME_OPTIONS
    || normalized.length > MAX_AVAILABILITY_TIME_OPTIONS
    || normalized.some((value) => !isLocalTime(value))
  ) {
    throw new Error(
      `timeOptions must contain ${MIN_AVAILABILITY_TIME_OPTIONS}-${MAX_AVAILABILITY_TIME_OPTIONS} unique HH:mm values`,
    );
  }
  return normalized;
}

export function isVoteEligibleAt(vote: Pick<Vote, "option" | "availableAfter">, time: string): boolean {
  return vote.option === "going"
    && (vote.availableAfter === undefined || vote.availableAfter === null || vote.availableAfter <= time);
}

export function isVoteEligibleForMatch(
  match: Pick<Match, "timeMode" | "selectedTime">,
  vote: Pick<Vote, "option" | "availableAfter">,
): boolean {
  if (vote.option !== "going") return false;
  return matchTimeMode(match) === "exact"
    || match.selectedTime === undefined
    || match.selectedTime === null
    || isVoteEligibleAt(vote, match.selectedTime);
}

export function cumulativeAvailabilityCount(
  votes: readonly Pick<Vote, "option" | "availableAfter">[],
  time: string,
  externalParticipants = 0,
): number {
  return votes.filter((vote) => isVoteEligibleAt(vote, time)).length + externalParticipants;
}
