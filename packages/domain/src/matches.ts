import {
  matchStatuses,
  type Match,
  type MatchStatus,
  type NotificationType,
} from "./types.js";
import { assertValidMatch, DomainValidationError } from "./validation.js";

export const MAX_CANCELLATION_REASON_LENGTH = 500;

export interface MatchTransitionEvaluation {
  readonly from: MatchStatus;
  readonly to: MatchStatus;
  readonly notificationType?: Extract<NotificationType, "match_confirmed" | "match_cancelled">;
  readonly notificationTransitionKey?: "status:confirmed" | "status:cancelled";
  readonly publicCardAction: "retain" | "delete";
  readonly votesEditableAfter: boolean;
}

export class LifecycleConflictError extends Error {
  public readonly from: MatchStatus;
  public readonly to: MatchStatus;

  public constructor(from: MatchStatus, to: MatchStatus) {
    super(`Cannot transition match from ${from} to ${to}`);
    this.name = "LifecycleConflictError";
    this.from = from;
    this.to = to;
  }
}

const allowedTransitions: Readonly<Record<MatchStatus, readonly MatchStatus[]>> = {
  draft: ["active"],
  active: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isMatchStatus(value: unknown): value is MatchStatus {
  return typeof value === "string" && matchStatuses.includes(value as MatchStatus);
}

export function allowedMatchTransitions(status: MatchStatus): readonly MatchStatus[] {
  return allowedTransitions[status];
}

export function canTransitionMatch(from: MatchStatus, to: MatchStatus): boolean {
  return isMatchStatus(from) && isMatchStatus(to) && allowedTransitions[from].includes(to);
}

export function evaluateMatchTransition(input: {
  readonly from: MatchStatus;
  readonly to: MatchStatus;
}): MatchTransitionEvaluation {
  if (!isMatchStatus(input.from) || !isMatchStatus(input.to)) {
    throw new DomainValidationError([{
      path: "status",
      code: "invalid_value",
      message: "from and to must be supported match statuses",
    }]);
  }
  if (!canTransitionMatch(input.from, input.to)) {
    throw new LifecycleConflictError(input.from, input.to);
  }

  const isCancelled = input.to === "cancelled";
  const isCompleted = input.to === "completed";
  const isConfirmed = input.to === "confirmed";
  return {
    from: input.from,
    to: input.to,
    ...(isConfirmed
      ? { notificationType: "match_confirmed" as const, notificationTransitionKey: "status:confirmed" as const }
      : isCancelled
        ? { notificationType: "match_cancelled" as const, notificationTransitionKey: "status:cancelled" as const }
        : {}),
    publicCardAction: isCancelled || isCompleted ? "delete" : "retain",
    votesEditableAfter: input.to === "active" || input.to === "confirmed",
  };
}

function cancellationReason(value: string | null | undefined): string {
  const normalized = value?.normalize("NFC").replace(/\s+/gu, " ").trim() ?? "";
  if (normalized === "") throw new Error("cancellationReason is required when cancelling a match");
  if (normalized.length > MAX_CANCELLATION_REASON_LENGTH) {
    throw new Error(`cancellationReason must be at most ${MAX_CANCELLATION_REASON_LENGTH} characters`);
  }
  return normalized;
}

export interface TransitionMatchOptions {
  readonly cancellationReason?: string | null;
  readonly now?: Date;
}

/** Returns a new match and never mutates the caller's match object. */
export function transitionMatch(
  match: Match,
  to: MatchStatus,
  options: TransitionMatchOptions = {},
): Match {
  const validMatch = assertValidMatch(match);
  const transition = evaluateMatchTransition({ from: validMatch.status, to });
  if (options.now !== undefined && (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))) {
    throw new Error("now must be a valid Date");
  }

  let nextCancellationReason: string | null = null;
  if (to === "cancelled") nextCancellationReason = cancellationReason(options.cancellationReason);
  else if (options.cancellationReason !== undefined && options.cancellationReason !== null && options.cancellationReason.trim() !== "") {
    throw new Error("cancellationReason is only valid for cancellation");
  }

  return {
    ...validMatch,
    status: transition.to,
    cancellationReason: nextCancellationReason,
    ...(options.now === undefined ? {} : { updatedAt: new Date(options.now.getTime()) }),
  };
}

export function isEditableMatchStatus(status: MatchStatus): status is "active" | "confirmed" {
  return status === "active" || status === "confirmed";
}

export function isTerminalMatchStatus(status: MatchStatus): status is "completed" | "cancelled" {
  return status === "completed" || status === "cancelled";
}

export function isThresholdRosterCapacityValid(_goingCount: number, _requiredPlayers: number): true {
  // Required players is deliberately a threshold, so a roster may exceed it.
  return true;
}
