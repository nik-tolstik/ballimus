import type { InlineKeyboardMarkup } from "grammy/types";

import type { Match, Vote } from "../db/schema.js";
import { renderMatchCard } from "../domain/match-card.js";

export const MATCH_VOTE_OPTIONS = ["going", "maybe", "not_going"] as const;
export type MatchVoteOption = (typeof MATCH_VOTE_OPTIONS)[number];

export type MatchAction =
  | { kind: "vote"; matchId: number; option: MatchVoteOption }
  | { kind: "confirm"; matchId: number }
  | { kind: "complete"; matchId: number }
  | { kind: "cancel"; matchId: number };

export interface MatchCallbackUpdate {
  updateId: number;
  callbackQueryId: string;
  telegramUserId: number;
  username: string | null;
  displayName: string;
  chatId: number;
  messageId: number;
  action: MatchAction;
}

export interface MatchCardContent {
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export function callbackData(action: MatchAction): string {
  if (action.kind === "vote") return `vote:${action.matchId}:${action.option}`;
  return `match:${action.matchId}:${action.kind}`;
}

export function parseMatchAction(data: string): MatchAction | undefined {
  const parts = data.split(":");
  if (parts.length !== 3) return undefined;

  const matchId = Number(parts[1]);
  if (!Number.isSafeInteger(matchId) || matchId < 1) return undefined;

  if (parts[0] === "vote" && MATCH_VOTE_OPTIONS.includes(parts[2] as MatchVoteOption)) {
    return { kind: "vote", matchId, option: parts[2] as MatchVoteOption };
  }
  if (
    parts[0] === "match" &&
    (parts[2] === "confirm" || parts[2] === "complete" || parts[2] === "cancel")
  ) {
    return { kind: parts[2], matchId };
  }
  return undefined;
}

function voteText(option: MatchVoteOption): string {
  switch (option) {
    case "going":
      return "✅ Участвую";
    case "maybe":
      return "❓ Под вопросом";
    case "not_going":
      return "❌ Не смогу";
  }
}

export function publicCardKeyboard(matchId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      MATCH_VOTE_OPTIONS.map((option) => ({
        text: voteText(option),
        callback_data: callbackData({ kind: "vote", matchId, option }),
      })),
    ],
  };
}

export function adminPanelKeyboard(matchId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      {
        text: "✅ Матч будет",
        callback_data: callbackData({ kind: "confirm", matchId }),
      },
      {
        text: "🚫 Отменить",
        callback_data: callbackData({ kind: "cancel", matchId }),
      },
    ]],
  };
}

export function confirmedAdminPanelKeyboard(matchId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      {
        text: "✅ Завершить",
        callback_data: callbackData({ kind: "complete", matchId }),
      },
      {
        text: "🚫 Отменить",
        callback_data: callbackData({ kind: "cancel", matchId }),
      },
    ]],
  };
}

export function matchCardContent(
  match: Match,
  votes: readonly Vote[],
  externalCount: number,
): MatchCardContent {
  const card = renderMatchCard({ match, votes, externalCount });
  return {
    text: card.text,
    ...(card.isActive ? { replyMarkup: publicCardKeyboard(match.id) } : {}),
  };
}

export function adminPanelContent(match: Match): MatchCardContent {
  const status = match.status === "active"
    ? "Голосование открыто."
    : match.status === "confirmed"
      ? "Матч подтверждён."
      : match.status === "completed"
        ? "Матч завершён."
        : "Матч отменён.";
  return {
    text: `Управление матчем #v${match.id}\n${status}`,
    ...(match.status === "active"
      ? { replyMarkup: adminPanelKeyboard(match.id) }
      : match.status === "confirmed"
        ? { replyMarkup: confirmedAdminPanelKeyboard(match.id) }
        : {}),
  };
}
