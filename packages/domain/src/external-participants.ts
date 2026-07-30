import {
  evaluateExternalQuantityTransition,
  type ExternalQuantityTransitionInput,
} from "./votes.js";
import type { ExternalParticipant, MatchId } from "./types.js";

export interface ExternalParticipantGroup {
  readonly label: string;
  readonly quantity: number;
}

function sameId(left: MatchId, right: MatchId): boolean {
  return left === right || String(left) === String(right);
}

function normalizedLabel(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Aggregates the quantity ledger by owner-provided source or contributor identity. */
export function groupExternalParticipants(
  participants: readonly ExternalParticipant[],
  matchId?: MatchId,
): ExternalParticipantGroup[] {
  const groups = new Map<string, { label: string; quantity: number }>();

  for (const participant of participants) {
    if (matchId !== undefined && !sameId(participant.matchId, matchId)) continue;
    if (!Number.isSafeInteger(participant.quantity) || participant.quantity === 0) {
      throw new Error("external participant quantity must be a non-zero safe integer");
    }

    const sourceLabel = normalizedLabel(participant.sourceLabel);
    const displayName = normalizedLabel(participant.displayNameSnapshot);
    const isUnnamed = sourceLabel === "";
    const key = isUnnamed
      ? `user:${String(participant.addedByTelegramUserId)}`
      : `source:${sourceLabel}`;
    const label = isUnnamed
      ? displayName === ""
        ? `ID ${String(participant.addedByTelegramUserId)}`
        : displayName
      : sourceLabel;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { label, quantity: participant.quantity });
    } else {
      existing.quantity += participant.quantity;
      if (existing.label.startsWith("ID ") && label !== existing.label && isUnnamed) {
        existing.label = label;
      }
    }
  }

  return [...groups.values()]
    .filter((group) => group.quantity !== 0)
    .sort((left, right) => left.label.localeCompare(right.label, "ru"))
    .map((group) => ({ label: group.label, quantity: group.quantity }));
}

export function totalExternalParticipantQuantity(
  participants: readonly ExternalParticipant[],
  matchId?: MatchId,
): number {
  let total = 0;
  for (const participant of participants) {
    if (matchId !== undefined && !sameId(participant.matchId, matchId)) continue;
    if (!Number.isSafeInteger(participant.quantity) || participant.quantity === 0) {
      throw new Error("external participant quantity must be a non-zero safe integer");
    }
    total += participant.quantity;
  }
  if (total < 0) throw new Error("external participant total cannot be negative");
  return total;
}

export const countExternalParticipantQuantity = totalExternalParticipantQuantity;

export interface ExternalQuantityChangeInput extends ExternalQuantityTransitionInput {
  readonly matchStatus?: "active" | "confirmed";
}

/**
 * Evaluates an owner quantity change and its threshold effects. A caller can
 * use the source count to prevent removing more entries than that source owns.
 */
export function evaluateExternalParticipantChange(
  input: ExternalQuantityChangeInput,
) {
  if (input.matchStatus !== undefined && input.matchStatus !== "active" && input.matchStatus !== "confirmed") {
    throw new Error("external participants are editable only for active or confirmed matches");
  }
  return evaluateExternalQuantityTransition(input);
}

export function isVoteEditable(status: string): status is "active" | "confirmed" {
  return status === "active" || status === "confirmed";
}

export const isExternalParticipantEditable = isVoteEditable;
