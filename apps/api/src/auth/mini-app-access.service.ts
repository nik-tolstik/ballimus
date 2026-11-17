import { Inject, Injectable } from "@nestjs/common";
import { MiniAppAdminsRepository, type AppDatabase } from "@football/db";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { APP_DATABASE } from "../database/database.constants.js";
import { restRequestError, toRestHttpException } from "../rest/rest.errors.js";
import type { MiniAppRole } from "./mini-app-auth.constants.js";

const MAX_TELEGRAM_USER_ID = BigInt(Number.MAX_SAFE_INTEGER);

export function parseTelegramUserId(value: unknown): bigint | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : undefined;
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/u.test(value)) return undefined;
  const id = BigInt(value);
  return id <= MAX_TELEGRAM_USER_ID ? id : undefined;
}

@Injectable()
export class MiniAppAccessService {
  private readonly admins: MiniAppAdminsRepository;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {
    this.admins = new MiniAppAdminsRepository(db);
  }

  public isOwner(id: bigint): boolean {
    return id === this.config.telegramOwnerUserId;
  }

  public async roleFor(id: bigint): Promise<MiniAppRole> {
    if (this.isOwner(id)) return "owner";
    try {
      return await this.admins.has(id) ? "admin" : "guest";
    } catch (error) {
      throw toRestHttpException(error);
    }
  }

  public async listAdmins(): Promise<string[]> {
    try {
      return (await this.admins.list(this.config.telegramOwnerUserId)).map(String);
    } catch (error) {
      throw toRestHttpException(error);
    }
  }

  public async setAdmin(rawId: string, enabled: boolean): Promise<void> {
    const id = parseTelegramUserId(rawId);
    if (id === undefined) {
      throw toRestHttpException(restRequestError(400, "TELEGRAM_USER_ID_INVALID", "Enter a valid Telegram user ID."));
    }
    if (this.isOwner(id)) {
      throw toRestHttpException(restRequestError(400, "TELEGRAM_OWNER_IMMUTABLE", "The configured owner already has full access."));
    }
    try {
      if (enabled) await this.admins.grant(id);
      else await this.admins.revoke(id);
    } catch (error) {
      throw toRestHttpException(error);
    }
  }
}
