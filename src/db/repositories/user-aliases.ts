import { desc, eq } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import { userAliases, type UserAlias } from "../schema.js";

export function normalizeTelegramUsername(username: string): string {
  return username.trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
}

export interface UpsertUserAliasInput {
  username: string;
  displayName: string;
  telegramUserId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class UserAliasesRepository {
  public constructor(private readonly db: AppDatabase) {}

  public findByUsername(username: string): UserAlias | undefined {
    return this.db
      .select()
      .from(userAliases)
      .where(eq(userAliases.username, normalizeTelegramUsername(username)))
      .get();
  }

  public findByTelegramUserId(telegramUserId: number): UserAlias | undefined {
    return this.db
      .select()
      .from(userAliases)
      .where(eq(userAliases.telegramUserId, telegramUserId))
      .orderBy(desc(userAliases.updatedAt))
      .get();
  }

  public upsert(input: UpsertUserAliasInput): UserAlias {
    const username = normalizeTelegramUsername(input.username);
    const existing = this.findByUsername(username);
    const record = this.db
      .insert(userAliases)
      .values({
        username,
        telegramUserId: input.telegramUserId ?? existing?.telegramUserId ?? null,
        displayName: input.displayName,
        createdAt: input.createdAt ?? new Date(),
        updatedAt: input.updatedAt ?? new Date(),
      })
      .onConflictDoUpdate({
        target: userAliases.username,
        set: {
          telegramUserId: input.telegramUserId ?? existing?.telegramUserId ?? null,
          displayName: input.displayName,
          updatedAt: input.updatedAt ?? new Date(),
        },
      })
      .returning()
      .get();

    if (record === undefined) throw new Error("User alias was not persisted");
    return record;
  }
}

export function createUserAliasesRepository(db: AppDatabase): UserAliasesRepository {
  return new UserAliasesRepository(db);
}
