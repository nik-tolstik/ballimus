import { BadRequestException, Inject, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { MemoryStorage, TelegramClient } from "@mtcute/node";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { TELEGRAM_API_TIMEOUT_MS, TelegramBotService } from "./telegram-effects.js";

export interface TelegramGroupMember {
  readonly telegramUserId: string;
  readonly displayName: string;
  readonly username: string | null;
}

@Injectable()
export class TelegramGroupMembersService implements OnModuleDestroy {
  private client: TelegramClient | undefined;
  private pending: Promise<TelegramGroupMember[]> | undefined;

  public constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(TelegramBotService) private readonly bot: Pick<TelegramBotService, "getChatMemberCount" | "isHumanChatMember">,
  ) {}

  public list(): Promise<TelegramGroupMember[]> {
    this.pending ??= this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  public async assertMember(userId: bigint): Promise<void> {
    let eligible: boolean;
    try {
      eligible = await this.bot.isHumanChatMember(this.config.telegramGroupChatId, userId);
    } catch {
      throw new ServiceUnavailableException({
        code: "TELEGRAM_GROUP_MEMBERS_UNAVAILABLE",
        message: "Could not verify Telegram group membership.",
      });
    }
    if (!eligible) {
      throw new BadRequestException({
        code: "TELEGRAM_GROUP_MEMBER_REQUIRED",
        message: "Select a current member of the configured Telegram group.",
      });
    }
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client?.destroy();
  }

  private async load(): Promise<TelegramGroupMember[]> {
    const credentials = this.config.telegramMtproto;
    if (credentials === undefined) {
      throw new ServiceUnavailableException({
        code: "TELEGRAM_GROUP_MEMBERS_NOT_CONFIGURED",
        message: "Telegram application credentials are required to list group members.",
      });
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Telegram roster lookup timed out.")), TELEGRAM_API_TIMEOUT_MS);
      });
      return await Promise.race([this.fetchMembers(credentials), deadline]);
    } catch {
      const client = this.client;
      this.client = undefined;
      await client?.destroy().catch(() => undefined);
      throw new ServiceUnavailableException({
        code: "TELEGRAM_GROUP_MEMBERS_UNAVAILABLE",
        message: "Could not load the complete Telegram group member list.",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchMembers(credentials: NonNullable<ApiConfig["telegramMtproto"]>): Promise<TelegramGroupMember[]> {
    const count = this.bot.getChatMemberCount(this.config.telegramGroupChatId);
    const read = async () => {
      let client = this.client;
      if (client === undefined) {
        client = new TelegramClient({ ...credentials, storage: new MemoryStorage(), disableUpdates: true, logLevel: 0 });
        this.client = client;
        await client.start({ botToken: this.config.telegramBotToken });
      }
      const group = await client.resolvePeer(Number(this.config.telegramGroupChatId));
      const ownerId = Number(this.config.telegramOwnerUserId);
      const seen = new Set<number>();
      const people: TelegramGroupMember[] = [];
      for await (const member of client.iterChatMembers(group)) {
        if (member.status === "left" || member.status === "banned" || (member.status === "restricted" && !member.isMember)) continue;
        const user = member.user;
        seen.add(user.id);
        if (user.isBot || user.isDeleted || user.id === ownerId) continue;
        people.push({ telegramUserId: String(user.id), displayName: user.displayName, username: user.username });
      }
      return { seen, people };
    };
    const [expected, { seen, people }] = await Promise.all([count, read()]);
    if (seen.size < expected) throw new Error("Telegram returned an incomplete group member list.");
    return people;
  }
}
