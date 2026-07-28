import {
  createUserRenamingService,
  parseRenameUserCommand,
} from "../../src/application/user-renaming.js";
import type { UserAlias } from "../../src/db/schema.js";
import { describe, expect, it } from "vitest";

describe("user renaming", () => {
  it("parses a username and a multi-word display name", () => {
    expect(parseRenameUserCommand("/rename_user @Chocolate  Ваня   Петров")).toEqual({
      username: "chocolate",
      displayName: "Ваня Петров",
    });
    expect(parseRenameUserCommand("/rename_user@football_bot @chocolate Ваня")).toEqual({
      username: "chocolate",
      displayName: "Ваня",
    });
  });

  it("rejects malformed commands", () => {
    expect(parseRenameUserCommand("/rename_user chocolate Ваня")).toBeUndefined();
    expect(parseRenameUserCommand("/rename_user @no Имя")).toBeUndefined();
    expect(parseRenameUserCommand("/rename_user @chocolate")).toBeUndefined();
  });

  it("stores an alias, updates existing votes, and resolves future votes", () => {
    const alias: UserAlias = {
      username: "chocolate",
      telegramUserId: null,
      displayName: "Ваня",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const aliases = new Map<string, UserAlias>();
    const service = createUserRenamingService({
      userAliases: {
        findByUsername: (username) => aliases.get(username),
        findByTelegramUserId: (telegramUserId) =>
          [...aliases.values()].find((item) => item.telegramUserId === telegramUserId),
        upsert: (input) => {
          const value = { ...alias, ...input };
          aliases.set(input.username, value);
          return value;
        },
      },
      votes: {
        findTelegramUserIdsByUsername: () => [55],
        renameUser: () => [3, 8],
      },
      externalParticipants: {
        updateDisplayNameByTelegramUserId: (telegramUserId, displayName) => {
          expect(telegramUserId).toBe(55);
          expect(displayName).toBe("Ваня");
          return [11];
        },
      },
    });

    const renamed = service.rename({ username: "@Chocolate", displayName: "Ваня" });

    expect(renamed.alias).toMatchObject({
      username: "chocolate",
      telegramUserId: 55,
      displayName: "Ваня",
    });
    expect(renamed.affectedMatchIds).toEqual([3, 8, 11]);
    expect(
      service.resolveDisplayName({
        telegramUserId: 55,
        username: "chocolate",
        fallback: "Chocolate",
      }),
    ).toBe("Ваня");
    expect(
      service.resolveDisplayName({
        telegramUserId: 56,
        username: "other",
        fallback: "Другой",
      }),
    ).toBe("Другой");
  });

  it("applies an alias saved before the user votes", () => {
    const aliases = new Map<string, UserAlias>();
    const service = createUserRenamingService({
      userAliases: {
        findByUsername: (username) => aliases.get(username),
        findByTelegramUserId: (telegramUserId) =>
          [...aliases.values()].find((item) => item.telegramUserId === telegramUserId),
        upsert: (input) => {
          const value: UserAlias = {
            username: input.username,
            telegramUserId: input.telegramUserId ?? null,
            displayName: input.displayName,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          aliases.set(input.username, value);
          return value;
        },
      },
      votes: {
        findTelegramUserIdsByUsername: () => [],
        renameUser: () => [],
      },
    });

    service.rename({ username: "chocolate", displayName: "Ваня" });

    expect(
      service.resolveDisplayName({
        telegramUserId: 56,
        username: "chocolate",
        fallback: "Chocolate",
      }),
    ).toBe("Ваня");
  });
});
