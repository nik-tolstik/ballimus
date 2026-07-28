import type { UserAlias } from "../db/schema.js";
import { normalizeTelegramUsername } from "../db/repositories/user-aliases.js";

export interface RenameUserCommand {
  username: string;
  displayName: string;
}

export interface UserRenamingRepositories {
  userAliases: {
    findByUsername(username: string): UserAlias | undefined;
    findByTelegramUserId(telegramUserId: number): UserAlias | undefined;
    upsert(input: {
      username: string;
      displayName: string;
      telegramUserId?: number | null;
    }): UserAlias;
  };
  votes: {
    findTelegramUserIdsByUsername(username: string): number[];
    renameUser(input: {
      username: string;
      displayName: string;
      telegramUserId?: number | null;
    }): number[];
  };
  externalParticipants?: {
    updateDisplayNameByTelegramUserId(telegramUserId: number, displayName: string): number[];
  };
}

export const RENAME_USER_USAGE = "Использование: /rename_user @username Имя Фамилия";

export function parseRenameUserCommand(text: string): RenameUserCommand | undefined {
  const match = /^\/rename_user(?:@[A-Za-z0-9_]{5,32})?\s+(@[A-Za-z][A-Za-z0-9_]{4,31})\s+(.+?)\s*$/iu.exec(
    text.trim(),
  );
  if (match === null) return undefined;

  const username = normalizeTelegramUsername(match[1] ?? "");
  const displayName = (match[2] ?? "").replace(/\s+/gu, " ").trim();
  if (username === "" || displayName === "") return undefined;

  return { username, displayName };
}

export interface RenameUserResult {
  alias: UserAlias;
  affectedMatchIds: number[];
}

export class UserRenamingService {
  public constructor(private readonly repositories: UserRenamingRepositories) {}

  public rename(command: RenameUserCommand): RenameUserResult {
    const username = normalizeTelegramUsername(command.username);
    const existingAlias = this.repositories.userAliases.findByUsername(username);
    const knownUserIds = this.repositories.votes.findTelegramUserIdsByUsername(username);
    const telegramUserId = knownUserIds.length === 1
      ? knownUserIds[0] ?? null
      : existingAlias?.telegramUserId ?? null;
    const alias = this.repositories.userAliases.upsert({
      username,
      displayName: command.displayName,
      telegramUserId,
    });
    const affectedMatchIds = new Set(this.repositories.votes.renameUser({
      username,
      displayName: command.displayName,
      telegramUserId,
    }));
    if (telegramUserId !== null && this.repositories.externalParticipants !== undefined) {
      for (const matchId of this.repositories.externalParticipants.updateDisplayNameByTelegramUserId(
        telegramUserId,
        command.displayName,
      )) {
        affectedMatchIds.add(matchId);
      }
    }

    return { alias, affectedMatchIds: [...affectedMatchIds] };
  }

  public resolveDisplayName(input: {
    telegramUserId: number;
    username?: string | null;
    fallback: string;
  }): string {
    const byId = this.repositories.userAliases.findByTelegramUserId(input.telegramUserId);
    if (byId !== undefined) return byId.displayName;

    if (input.username !== undefined && input.username !== null) {
      const byUsername = this.repositories.userAliases.findByUsername(input.username);
      if (
        byUsername !== undefined &&
        (byUsername.telegramUserId === null || byUsername.telegramUserId === input.telegramUserId)
      ) {
        return byUsername.displayName;
      }
    }

    return input.fallback.trim() || "Игрок";
  }
}

export function createUserRenamingService(
  repositories: UserRenamingRepositories,
): UserRenamingService {
  return new UserRenamingService(repositories);
}
