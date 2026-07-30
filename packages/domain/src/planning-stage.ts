import { isTimePollMode, matchTimeMode } from "./availability.js";
import type { Match } from "./types.js";

export const matchPlanningStages = [
  "recruiting_players",
  "finalizing_details",
  "ready_to_confirm",
] as const;

export type MatchPlanningStage = (typeof matchPlanningStages)[number];

type PlanningMatch = Pick<
  Match,
  "location" | "requiredPlayers" | "scheduledAt" | "selectedTime" | "status" | "timeMode"
>;

export function hasResolvedMatchTime(match: PlanningMatch): boolean {
  if (isTimePollMode(matchTimeMode(match))) {
    return match.selectedTime !== null
      && match.selectedTime !== undefined
      && match.scheduledAt !== null;
  }
  return match.scheduledAt !== null;
}

/** Derives the owner's current planning task without persisting redundant state. */
export function deriveMatchPlanningStage(
  match: PlanningMatch,
  goingCount: number,
): MatchPlanningStage | null {
  if (match.status !== "active") return null;
  if (goingCount < match.requiredPlayers) return "recruiting_players";
  if (!hasResolvedMatchTime(match) || match.location?.trim() === "" || match.location === null) {
    return "finalizing_details";
  }
  return "ready_to_confirm";
}

export function matchPlanningStageLabel(stage: MatchPlanningStage): string {
  switch (stage) {
    case "recruiting_players":
      return "Набираем игроков";
    case "finalizing_details":
      return "Уточняем время и место";
    case "ready_to_confirm":
      return "Готов к подтверждению";
  }
}
