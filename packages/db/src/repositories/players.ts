import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  externalParticipants,
  playerUsernames,
  players,
  votes,
  type Player,
  type PlayerAvatarContentType,
  type PlayerUsername,
} from "../schema.js";
import { normalizeTelegramUsername } from "../serialization.js";
import {
  effectiveNow,
  nonEmpty,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
} from "./common.js";
import {
  DuplicateRepositoryError,
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./errors.js";

export interface TelegramIdentityInput {
  readonly telegramUserId: DatabaseIdentifier;
  readonly username?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly languageCode?: string | null;
  readonly displayName?: string | null;
  readonly seenAt?: Date;
}

export interface CreatePlayerInput {
  readonly telegramUserId?: DatabaseIdentifier | null;
  readonly displayName?: string | null;
  readonly telegramUsernameSnapshot?: string | null;
  readonly telegramFirstNameSnapshot?: string | null;
  readonly telegramLastNameSnapshot?: string | null;
  readonly telegramLanguageCode?: string | null;
  readonly lastSeenAt?: Date | null;
}

export interface CreateAliasInput {
  readonly username: string;
  readonly displayName: string;
  readonly playerId?: DatabaseIdentifier;
  readonly telegramUserId?: DatabaseIdentifier;
  readonly seenAt?: Date;
}

export interface PlayerListOptions {
  readonly search?: string;
  readonly confirmed?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export type PlayerAvatarCacheInput =
  | {
      readonly fileUniqueId: string;
      readonly contentType: PlayerAvatarContentType;
      readonly dataBase64: string;
    }
  | {
      readonly fileUniqueId: null;
      readonly contentType: null;
      readonly dataBase64: null;
    };

export interface BindTelegramUserResult {
  readonly player: Player;
  readonly username?: PlayerUsername;
  readonly wasBound: boolean;
  readonly wasCreated: boolean;
}

function normalizeUsername(username: string): string {
  const normalized = normalizeTelegramUsername(username);
  if (!/^[a-z][a-z0-9_]{4,31}$/u.test(normalized)) {
    throw new ValidationRepositoryError("username must be a valid normalized Telegram username");
  }
  return normalized;
}

function normalizeDisplayName(value: string | null | undefined, fieldName = "displayName"): string | null {
  if (value === undefined || value === null) return null;
  return nonEmpty(value, fieldName, 200);
}

function normalizeSnapshot(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.normalize("NFC").trim();
  return normalized === "" ? null : normalized;
}

function readableName(input: TelegramIdentityInput, normalizedUsername: string | null): string {
  const explicit = normalizeDisplayName(input.displayName);
  if (explicit !== null) return explicit;
  const parts = [normalizeSnapshot(input.firstName), normalizeSnapshot(input.lastName)]
    .filter((value): value is string => value !== null);
  if (parts.length > 0) return parts.join(" ");
  if (normalizedUsername !== null) return `@${normalizedUsername}`;
  return `Telegram user ${positiveBigInt(input.telegramUserId, "telegramUserId").toString(10)}`;
}

function usernameOrUndefined(row: PlayerUsername | undefined): PlayerUsername | undefined {
  return row;
}

function validatedAvatarCache(input: PlayerAvatarCacheInput): PlayerAvatarCacheInput {
  if (input.fileUniqueId === null) return input;
  const fileUniqueId = nonEmpty(input.fileUniqueId, "fileUniqueId", 200);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(input.dataBase64)) {
    throw new ValidationRepositoryError("dataBase64 must be valid base64");
  }
  if (input.dataBase64.length === 0 || input.dataBase64.length > 349_528) {
    throw new ValidationRepositoryError("dataBase64 must contain at most 256 KiB of image data");
  }
  return { ...input, fileUniqueId };
}

/** Canonical player profiles and atomic Telegram identity binding. */
export class PlayersRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async findById(id: DatabaseIdentifier): Promise<Player | undefined> {
    const rows = await this.db.select().from(players).where(eq(players.id, positiveBigInt(id, "playerId"))).limit(1);
    return rows[0];
  }

  public async getById(id: DatabaseIdentifier): Promise<Player> {
    const player = await this.findById(id);
    if (player === undefined) throw new NotFoundRepositoryError(`Player ${String(id)} was not found`);
    return player;
  }

  public async findByTelegramUserId(telegramUserId: DatabaseIdentifier): Promise<Player | undefined> {
    const rows = await this.db
      .select()
      .from(players)
      .where(eq(players.telegramUserId, positiveBigInt(telegramUserId, "telegramUserId")))
      .limit(1);
    return rows[0];
  }

  public async findByUsername(username: string): Promise<Player | undefined> {
    const alias = await new PlayerUsernamesRepository(this.db).findByUsername(username);
    if (alias === undefined) return undefined;
    return this.findById(alias.playerId);
  }

  public async updateAvatarCache(
    telegramUserId: DatabaseIdentifier,
    input: PlayerAvatarCacheInput,
    refreshedAt?: Date,
  ): Promise<Player> {
    const id = positiveBigInt(telegramUserId, "telegramUserId");
    const cache = validatedAvatarCache(input);
    const timestamp = effectiveNow(refreshedAt);
    const rows = await this.db
      .update(players)
      .set({
        avatarFileUniqueId: cache.fileUniqueId,
        avatarContentType: cache.contentType,
        avatarDataBase64: cache.dataBase64,
        avatarRefreshedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(players.telegramUserId, id))
      .returning();
    const player = rows[0];
    if (player === undefined) {
      throw new NotFoundRepositoryError(`Telegram player ${id.toString(10)} was not found`);
    }
    return player;
  }

  public async list(options: PlayerListOptions = {}): Promise<Player[]> {
    const conditions = [];
    if (options.confirmed === true) conditions.push(eq(players.telegramUserId, players.telegramUserId));
    if (options.confirmed === false) conditions.push(isNull(players.telegramUserId));
    if (options.search !== undefined) {
      const search = nonEmpty(options.search, "search", 200);
      const pattern = `%${search.replace(/[%_]/gu, (value) => `\\${value}`)}%`;
      conditions.push(ilike(players.displayName, pattern));
    }
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
      throw new ValidationRepositoryError("limit must be a positive safe integer");
    }
    if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0)) {
      throw new ValidationRepositoryError("offset must be a non-negative safe integer");
    }
    const query = this.db
      .select()
      .from(players)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(players.displayName), asc(players.id));
    if (options.limit !== undefined) query.limit(options.limit);
    if (options.offset !== undefined) query.offset(options.offset);
    return query;
  }

  public async create(input: CreatePlayerInput): Promise<Player> {
    const telegramUserId = input.telegramUserId === undefined || input.telegramUserId === null
      ? null
      : positiveBigInt(input.telegramUserId, "telegramUserId");
    const now = effectiveNow(input.lastSeenAt ?? undefined);
    const rows = await this.db
      .insert(players)
      .values({
        telegramUserId,
        displayName: normalizeDisplayName(input.displayName),
        telegramUsernameSnapshot: normalizeSnapshot(input.telegramUsernameSnapshot),
        telegramFirstNameSnapshot: normalizeSnapshot(input.telegramFirstNameSnapshot),
        telegramLastNameSnapshot: normalizeSnapshot(input.telegramLastNameSnapshot),
        telegramLanguageCode: normalizeSnapshot(input.telegramLanguageCode),
        lastSeenAt: input.lastSeenAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const player = rows[0];
    if (player === undefined) throw new NotFoundRepositoryError("Player was not created");
    return player;
  }

  public async createAlias(input: CreateAliasInput): Promise<{ player: Player; username: PlayerUsername }> {
    return this.db.transaction(async (tx) => new PlayersRepository(tx).createAliasInTransaction(input));
  }

  public async createAliasInTransaction(
    input: CreateAliasInput,
  ): Promise<{ player: Player; username: PlayerUsername }> {
    const normalizedUsername = normalizeUsername(input.username);
    const displayName = nonEmpty(input.displayName, "displayName", 200);
    const now = effectiveNow(input.seenAt);
    const aliases = new PlayerUsernamesRepository(this.db);
    const existingAlias = await aliases.findByUsernameForUpdate(normalizedUsername);
    let player: Player;
    if (input.playerId !== undefined) {
      player = await this.getById(input.playerId);
      if (existingAlias !== undefined && existingAlias.playerId !== player.id) {
        throw new RepositoryConflictError("The username is already mapped to another player", {
          details: { username: normalizedUsername, playerId: existingAlias.playerId },
        });
      }
    } else if (existingAlias !== undefined) {
      player = await this.getById(existingAlias.playerId);
    } else if (input.telegramUserId !== undefined) {
      player = await this.bindTelegramUserInTransaction({
        telegramUserId: input.telegramUserId,
        username: normalizedUsername,
        displayName,
        seenAt: now,
      }).then((result) => result.player);
    } else {
      player = await this.create({ displayName, lastSeenAt: now });
    }

    if (input.telegramUserId !== undefined && player.telegramUserId !== null) {
      const requestedId = positiveBigInt(input.telegramUserId, "telegramUserId");
      if (player.telegramUserId !== requestedId) {
        throw new RepositoryConflictError("The player is already bound to another Telegram user", {
          details: { playerId: player.id, telegramUserId: player.telegramUserId },
        });
      }
    }

    if (player.displayName !== displayName) {
      player = await this.updateDisplayNameInTransaction(player.id, displayName, now);
    }

    const username = existingAlias === undefined
      ? await aliases.createInTransaction({ normalizedUsername, playerId: player.id, seenAt: now })
      : await aliases.touchInTransaction(normalizedUsername, now);
    return { player, username };
  }

  public async bindTelegramUser(input: TelegramIdentityInput): Promise<BindTelegramUserResult> {
    return this.db.transaction(async (tx) => new PlayersRepository(tx).bindTelegramUserInTransaction(input));
  }

  /** Resolves by immutable Telegram ID first and binds an unconfirmed username alias exactly once. */
  public async bindTelegramUserInTransaction(input: TelegramIdentityInput): Promise<BindTelegramUserResult> {
    const telegramUserId = positiveBigInt(input.telegramUserId, "telegramUserId");
    const username = input.username === undefined || input.username === null
      ? null
      : normalizeUsername(input.username);
    const now = effectiveNow(input.seenAt);
    const readable = readableName(input, username);
    const boundRows = await this.db
      .select()
      .from(players)
      .where(eq(players.telegramUserId, telegramUserId))
      .limit(1)
      .for("update");
    let player = boundRows[0];
    let wasBound = false;
    let wasCreated = false;
    let alias: PlayerUsername | undefined;

    if (username !== null) {
      const aliases = new PlayerUsernamesRepository(this.db);
      alias = await aliases.findByUsernameForUpdate(username);
      if (alias !== undefined && player !== undefined && alias.playerId !== player.id) {
        throw new RepositoryConflictError("The Telegram username is mapped to another bound player", {
          details: { username, telegramUserId, mappedPlayerId: alias.playerId, boundPlayerId: player.id },
        });
      }
      if (player === undefined && alias !== undefined) {
        const aliasPlayerRows = await this.db
          .select()
          .from(players)
          .where(eq(players.id, alias.playerId))
          .limit(1)
          .for("update");
        const aliasPlayer = aliasPlayerRows[0];
        if (aliasPlayer === undefined) throw new NotFoundRepositoryError("The username alias player was not found");
        if (aliasPlayer.telegramUserId !== null && aliasPlayer.telegramUserId !== telegramUserId) {
          throw new RepositoryConflictError("The Telegram username is already bound to another Telegram user", {
            details: { username, telegramUserId, existingTelegramUserId: aliasPlayer.telegramUserId },
          });
        }
        player = aliasPlayer;
        if (player.telegramUserId === null) {
          const bound = await this.db
            .update(players)
            .set({ telegramUserId, updatedAt: now })
            .where(and(eq(players.id, player.id), isNull(players.telegramUserId)))
            .returning();
          const next = bound[0];
          if (next === undefined) throw new RepositoryConflictError("The username alias was bound concurrently");
          player = next;
          wasBound = true;
        }
      }
    }

    if (player === undefined) {
      const created = await this.db
        .insert(players)
        .values({
          telegramUserId,
          displayName: readable,
          telegramUsernameSnapshot: username,
          telegramFirstNameSnapshot: normalizeSnapshot(input.firstName),
          telegramLastNameSnapshot: normalizeSnapshot(input.lastName),
          telegramLanguageCode: normalizeSnapshot(input.languageCode),
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      player = created[0];
      if (player === undefined) throw new NotFoundRepositoryError("Telegram player was not created");
      wasCreated = true;
    }

    const nextDisplayName = player.displayName ?? readable;
    const updatedRows = await this.db
      .update(players)
      .set({
        displayName: nextDisplayName,
        telegramUsernameSnapshot: username,
        telegramFirstNameSnapshot: normalizeSnapshot(input.firstName),
        telegramLastNameSnapshot: normalizeSnapshot(input.lastName),
        telegramLanguageCode: normalizeSnapshot(input.languageCode),
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(players.id, player.id))
      .returning();
    player = updatedRows[0] ?? player;

    if (username !== null) {
      const aliases = new PlayerUsernamesRepository(this.db);
      if (alias === undefined) {
        alias = await aliases.createInTransaction({ normalizedUsername: username, playerId: player.id, seenAt: now });
      } else if (alias.playerId !== player.id) {
        throw new RepositoryConflictError("The username mapping cannot be rebound", {
          details: { username, playerId: alias.playerId },
        });
      } else {
        alias = await aliases.touchInTransaction(username, now);
      }
    }
    if (usernameOrUndefined(alias) === undefined) {
      return { player, wasBound, wasCreated };
    }
    return { player, username: alias as PlayerUsername, wasBound, wasCreated };
  }

  public async updateDisplayName(
    id: DatabaseIdentifier,
    displayName: string,
    now?: Date,
  ): Promise<Player> {
    return this.db.transaction(async (tx) => new PlayersRepository(tx).updateDisplayNameInTransaction(id, displayName, now));
  }

  public async updateDisplayNameInTransaction(
    id: DatabaseIdentifier,
    displayName: string,
    now?: Date,
  ): Promise<Player> {
    const playerId = positiveBigInt(id, "playerId");
    const normalized = nonEmpty(displayName, "displayName", 200);
    const currentRows = await this.db.select().from(players).where(eq(players.id, playerId)).limit(1).for("update");
    if (currentRows[0] === undefined) throw new NotFoundRepositoryError(`Player ${playerId} was not found`);
    const timestamp = effectiveNow(now);
    const rows = await this.db
      .update(players)
      .set({ displayName: normalized, updatedAt: timestamp })
      .where(eq(players.id, playerId))
      .returning();
    const player = rows[0];
    if (player === undefined) throw new NotFoundRepositoryError(`Player ${playerId} was not found`);
    await this.db
      .update(votes)
      .set({ displayNameSnapshot: normalized, updatedAt: timestamp })
      .where(eq(votes.playerId, playerId));
    await this.db
      .update(externalParticipants)
      .set({ displayName: normalized, updatedAt: timestamp })
      .where(and(eq(externalParticipants.createdByTelegramUserId, player.telegramUserId ?? 0n), isNull(externalParticipants.displayName)));
    return player;
  }

  public async deleteUnconfirmedAlias(username: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const aliases = new PlayerUsernamesRepository(tx);
      const alias = await aliases.findByUsernameForUpdate(username);
      if (alias === undefined) return false;
      const player = await new PlayersRepository(tx).getById(alias.playerId);
      if (player.telegramUserId !== null) {
        throw new RepositoryConflictError("A confirmed player alias cannot be removed by this operation");
      }
      const deletedAlias = await aliases.deleteInTransaction(alias.normalizedUsername);
      if (deletedAlias) await tx.delete(players).where(and(eq(players.id, player.id), isNull(players.telegramUserId)));
      return deletedAlias;
    });
  }
}

/** Normalized username mapping repository. It intentionally never exposes a rebinding operation. */
export class PlayerUsernamesRepository {
  public constructor(private readonly db: DatabaseExecutor) {}

  public async findByUsername(username: string): Promise<PlayerUsername | undefined> {
    const normalized = normalizeUsername(username);
    const rows = await this.db
      .select()
      .from(playerUsernames)
      .where(eq(playerUsernames.normalizedUsername, normalized))
      .limit(1);
    return rows[0];
  }

  public async findByUsernameForUpdate(username: string): Promise<PlayerUsername | undefined> {
    const normalized = normalizeUsername(username);
    const rows = await this.db
      .select()
      .from(playerUsernames)
      .where(eq(playerUsernames.normalizedUsername, normalized))
      .limit(1)
      .for("update");
    return rows[0];
  }

  public async findByPlayerId(playerId: DatabaseIdentifier): Promise<PlayerUsername[]> {
    return this.db
      .select()
      .from(playerUsernames)
      .where(eq(playerUsernames.playerId, positiveBigInt(playerId, "playerId")))
      .orderBy(desc(playerUsernames.updatedAt));
  }

  public async create(input: {
    readonly username: string;
    readonly playerId: DatabaseIdentifier;
    readonly seenAt?: Date;
  }): Promise<PlayerUsername> {
    return this.db.transaction(async (tx) => new PlayerUsernamesRepository(tx).createInTransaction({
      normalizedUsername: normalizeUsername(input.username),
      playerId: positiveBigInt(input.playerId, "playerId"),
      ...(input.seenAt === undefined ? {} : { seenAt: input.seenAt }),
    }));
  }

  public async createInTransaction(input: {
    readonly normalizedUsername: string;
    readonly playerId: bigint;
    readonly seenAt?: Date;
  }): Promise<PlayerUsername> {
    const normalizedUsername = normalizeUsername(input.normalizedUsername);
    const now = effectiveNow(input.seenAt);
    const existing = await this.findByUsernameForUpdate(normalizedUsername);
    if (existing !== undefined) {
      if (existing.playerId !== input.playerId) {
        throw new DuplicateRepositoryError("The normalized username already belongs to another player", {
          details: { normalizedUsername, playerId: existing.playerId },
        });
      }
      return this.touchInTransaction(normalizedUsername, now);
    }
    const rows = await this.db
      .insert(playerUsernames)
      .values({ normalizedUsername, playerId: input.playerId, lastSeenAt: now, createdAt: now, updatedAt: now })
      .returning();
    const alias = rows[0];
    if (alias === undefined) throw new NotFoundRepositoryError("Username mapping was not created");
    return alias;
  }

  public async touch(username: string, seenAt?: Date): Promise<PlayerUsername> {
    return this.db.transaction(async (tx) => new PlayerUsernamesRepository(tx).touchInTransaction(normalizeUsername(username), effectiveNow(seenAt)));
  }

  public async touchInTransaction(username: string, seenAt: Date): Promise<PlayerUsername> {
    const normalizedUsername = normalizeUsername(username);
    const rows = await this.db
      .update(playerUsernames)
      .set({ lastSeenAt: seenAt, updatedAt: seenAt })
      .where(eq(playerUsernames.normalizedUsername, normalizedUsername))
      .returning();
    const alias = rows[0];
    if (alias === undefined) throw new NotFoundRepositoryError(`Username ${normalizedUsername} was not found`);
    return alias;
  }

  public async delete(username: string): Promise<boolean> {
    return this.db.transaction(async (tx) => new PlayerUsernamesRepository(tx).deleteInTransaction(normalizeUsername(username)));
  }

  public async deleteInTransaction(username: string): Promise<boolean> {
    const rows = await this.db
      .delete(playerUsernames)
      .where(eq(playerUsernames.normalizedUsername, normalizeUsername(username)))
      .returning({ normalizedUsername: playerUsernames.normalizedUsername });
    return rows.length > 0;
  }
}

export function createPlayersRepository(db: AppDatabase): PlayersRepository {
  return new PlayersRepository(db);
}

export function createPlayerUsernamesRepository(db: AppDatabase): PlayerUsernamesRepository {
  return new PlayerUsernamesRepository(db);
}
