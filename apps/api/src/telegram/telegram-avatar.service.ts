import { Inject, Injectable } from "@nestjs/common";
import { PlayersRepository } from "@football/db";
import type { AppDatabase } from "@football/db";

import { APP_DATABASE } from "../database/database.constants.js";
import { TelegramBotService } from "./telegram-effects.js";

export const PLAYER_AVATAR_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

export type TelegramAvatarRefreshResult =
  | { readonly status: "fresh" | "player_missing" }
  | { readonly status: "updated"; readonly hasAvatar: boolean };

/** Refreshes the private Telegram profile-photo cache after a committed vote. */
@Injectable()
export class TelegramAvatarService {
  public constructor(
    @Inject(APP_DATABASE) private readonly database: AppDatabase,
    @Inject(TelegramBotService) private readonly telegramBot: TelegramBotService,
  ) {}

  public async refreshIfStale(
    telegramUserId: bigint,
    now = new Date(),
  ): Promise<TelegramAvatarRefreshResult> {
    const players = new PlayersRepository(this.database);
    const player = await players.findByTelegramUserId(telegramUserId);
    if (player === undefined) return { status: "player_missing" };
    if (
      player.avatarRefreshedAt !== null
      && now.getTime() - player.avatarRefreshedAt.getTime() < PLAYER_AVATAR_REFRESH_INTERVAL_MS
    ) {
      return { status: "fresh" };
    }

    const avatar = await this.telegramBot.getUserProfileAvatar(telegramUserId);
    await players.updateAvatarCache(
      telegramUserId,
      avatar ?? { fileUniqueId: null, contentType: null, dataBase64: null },
      now,
    );
    return { status: "updated", hasAvatar: avatar !== null };
  }
}
