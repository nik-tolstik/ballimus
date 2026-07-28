import { normalizeTelegramUsername } from "../db/repositories/user-aliases.js";

export type RemoveVoteTarget =
  | { kind: "username"; username: string }
  | { kind: "telegram_user_id"; telegramUserId: number };

export interface RemoveVoteCommand {
  matchId: number;
  target: RemoveVoteTarget;
}

export const REMOVE_VOTE_USAGE =
  "Использование: /remove_vote #v32 @username или /remove_vote #v32 123456789";

const REMOVE_VOTE_COMMAND = /^\/remove_vote(?:@[A-Za-z0-9_]{5,32})?\s+#?v?([1-9]\d*)\s+(@[A-Za-z][A-Za-z0-9_]{4,31}|[1-9]\d*)\s*$/iu;

/** Parses a private administrator command that removes one current vote. */
export function parseRemoveVoteCommand(text: string): RemoveVoteCommand | undefined {
  const match = REMOVE_VOTE_COMMAND.exec(text.trim());
  if (match?.[1] === undefined || match[2] === undefined) return undefined;

  const matchId = Number(match[1]);
  if (!Number.isSafeInteger(matchId) || matchId < 1) return undefined;

  const rawTarget = match[2].trim();
  if (rawTarget.startsWith("@")) {
    const username = normalizeTelegramUsername(rawTarget);
    return username === ""
      ? undefined
      : { matchId, target: { kind: "username", username } };
  }

  const telegramUserId = Number(rawTarget);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId < 1) return undefined;
  return { matchId, target: { kind: "telegram_user_id", telegramUserId } };
}
