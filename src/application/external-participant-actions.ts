import type { InlineKeyboardMarkup } from "grammy/types";

export const EXTERNAL_PARTICIPANT_ACTIONS = ["menu", "add", "remove"] as const;
export type ExternalParticipantActionKind = (typeof EXTERNAL_PARTICIPANT_ACTIONS)[number];

export interface ExternalParticipantAction {
  kind: ExternalParticipantActionKind;
  matchId: number;
}

export interface ExternalParticipantMenuContent {
  text: string;
  replyMarkup: InlineKeyboardMarkup;
}

export function externalParticipantCallbackData(action: ExternalParticipantAction): string {
  return `external:${action.matchId}:${action.kind}`;
}

export function parseExternalParticipantAction(
  data: string,
): ExternalParticipantAction | undefined {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "external") return undefined;

  const matchId = Number(parts[1]);
  const kind = parts[2] as ExternalParticipantActionKind | undefined;
  if (
    !Number.isSafeInteger(matchId) ||
    matchId < 1 ||
    kind === undefined ||
    !EXTERNAL_PARTICIPANT_ACTIONS.includes(kind)
  ) {
    return undefined;
  }

  return { matchId, kind };
}

export function externalParticipantMenuContent(
  matchId: number,
  ownCount: number,
): ExternalParticipantMenuContent {
  return {
    text: `Дополнительные игроки для матча #v${matchId}\n` +
      `Вы добавили: ${ownCount}`,
    replyMarkup: {
      inline_keyboard: [[
        {
          text: "➕ Добавить игрока",
          callback_data: externalParticipantCallbackData({ kind: "add", matchId }),
        },
        {
          text: "➖ Убрать игрока",
          callback_data: externalParticipantCallbackData({ kind: "remove", matchId }),
        },
      ]],
    },
  };
}
