import type { ExternalParticipant } from "../db/schema.js";

export interface ExternalParticipantGroup {
  label: string;
  quantity: number;
}

export function groupExternalParticipants(
  participants: readonly ExternalParticipant[],
): ExternalParticipantGroup[] {
  const groups = new Map<string, ExternalParticipantGroup>();

  for (const participant of participants) {
    const sourceLabel = participant.sourceLabel?.trim();
    const displayName = participant.displayNameSnapshot?.trim();
    const isUnnamed = sourceLabel === undefined || sourceLabel === "";
    const key = isUnnamed
      ? `user:${participant.addedByTelegramUserId}`
      : `source:${sourceLabel}`;
    const label = isUnnamed
      ? displayName === undefined || displayName === ""
        ? `ID ${participant.addedByTelegramUserId}`
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
    .sort((left, right) => left.label.localeCompare(right.label, "ru"));
}
