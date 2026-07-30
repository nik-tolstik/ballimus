import type { Match, MatchTimeMode, Vote } from "./types.js";

export const MIN_AVAILABILITY_TIME_OPTIONS = 1;
export const MAX_AVAILABILITY_TIME_OPTIONS = 6;

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && LOCAL_TIME_PATTERN.test(value);
}

export function matchTimeMode(match: Pick<Match, "timeMode">): MatchTimeMode {
  return match.timeMode ?? "exact";
}

export function isTimePollMode(mode: MatchTimeMode): mode is "exact_options" | "availability" {
  return mode === "exact_options" || mode === "availability";
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
  vote: Pick<Vote, "option" | "availableAfter" | "exactTimes">,
): boolean {
  if (vote.option !== "going") return false;
  const mode = matchTimeMode(match);
  if (mode === "exact" || match.selectedTime === undefined || match.selectedTime === null) return true;
  return mode === "availability"
    ? isVoteEligibleAt(vote, match.selectedTime)
    : vote.exactTimes?.includes(match.selectedTime) === true || vote.availableAfter === match.selectedTime;
}

export function cumulativeAvailabilityCount(
  votes: readonly Pick<Vote, "option" | "availableAfter">[],
  time: string,
  externalParticipants = 0,
): number {
  return votes.filter((vote) => isVoteEligibleAt(vote, time)).length + externalParticipants;
}

export function selectedTimeForFinalTime(
  mode: MatchTimeMode,
  timeOptions: readonly string[],
  finalTime: string,
): string | null | undefined {
  if (mode === "exact") return null;
  if (mode === "exact_options") return timeOptions.includes(finalTime) ? finalTime : undefined;
  return timeOptions.filter((time) => time <= finalTime).at(-1);
}
