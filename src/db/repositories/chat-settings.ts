import { eq } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import { chatSettings, type ChatSettings } from "../schema.js";

export interface ChatSettingsInput {
  chatId: number;
  generalTopicId?: number | null;
  chatTopicId?: number | null;
  timezone: string;
  defaultThreshold?: number;
  createdAt?: Date;
}

export interface ChatSettingsUpdate {
  generalTopicId?: number | null;
  chatTopicId?: number | null;
  timezone?: string;
  defaultThreshold?: number;
}

export class ChatSettingsRepository {
  public constructor(private readonly db: AppDatabase) {}

  public findByChatId(chatId: number): ChatSettings | undefined {
    return this.db.select().from(chatSettings).where(eq(chatSettings.chatId, chatId)).get();
  }

  public getByChatId(chatId: number): ChatSettings | undefined {
    return this.findByChatId(chatId);
  }

  public create(input: ChatSettingsInput): ChatSettings {
    const now = new Date();
    const record = this.db
      .insert(chatSettings)
      .values({
        chatId: input.chatId,
        generalTopicId: input.generalTopicId ?? null,
        chatTopicId: input.chatTopicId ?? null,
        timezone: input.timezone,
        defaultThreshold: input.defaultThreshold ?? 10,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
      })
      .returning()
      .get();

    if (!record) {
      throw new Error("Chat settings were not created");
    }

    return record;
  }

  public upsert(input: ChatSettingsInput): ChatSettings {
    const now = new Date();
    const record = this.db
      .insert(chatSettings)
      .values({
        chatId: input.chatId,
        generalTopicId: input.generalTopicId ?? null,
        chatTopicId: input.chatTopicId ?? null,
        timezone: input.timezone,
        defaultThreshold: input.defaultThreshold ?? 10,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: chatSettings.chatId,
        set: {
          generalTopicId: input.generalTopicId ?? null,
          chatTopicId: input.chatTopicId ?? null,
          timezone: input.timezone,
          defaultThreshold: input.defaultThreshold ?? 10,
          updatedAt: now,
        },
      })
      .returning()
      .get();

    if (!record) {
      throw new Error("Chat settings were not upserted");
    }

    return record;
  }

  public update(chatId: number, input: ChatSettingsUpdate): ChatSettings | undefined {
    const values: {
      generalTopicId?: number | null;
      chatTopicId?: number | null;
      timezone?: string;
      defaultThreshold?: number;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (input.generalTopicId !== undefined) values.generalTopicId = input.generalTopicId;
    if (input.chatTopicId !== undefined) values.chatTopicId = input.chatTopicId;
    if (input.timezone !== undefined) values.timezone = input.timezone;
    if (input.defaultThreshold !== undefined) values.defaultThreshold = input.defaultThreshold;

    return this.db
      .update(chatSettings)
      .set(values)
      .where(eq(chatSettings.chatId, chatId))
      .returning()
      .get();
  }

  public delete(chatId: number): boolean {
    return this.db.delete(chatSettings).where(eq(chatSettings.chatId, chatId)).run().changes > 0;
  }
}

export function createChatSettingsRepository(db: AppDatabase): ChatSettingsRepository {
  return new ChatSettingsRepository(db);
}
