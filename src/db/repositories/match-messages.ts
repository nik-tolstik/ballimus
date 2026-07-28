import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  matchMessages,
  type MatchMessage,
  type MatchMessageKind,
} from "../schema.js";

export interface CreateMatchMessageInput {
  matchId: number;
  kind: MatchMessageKind;
  chatId: number;
  messageId: number;
  topicId?: number | null;
  createdAt?: Date;
}

export class MatchMessagesRepository {
  public constructor(private readonly db: AppDatabase) {}

  public findByMatchIdAndKind(
    matchId: number,
    kind: MatchMessageKind,
  ): MatchMessage | undefined {
    return this.db
      .select()
      .from(matchMessages)
      .where(and(eq(matchMessages.matchId, matchId), eq(matchMessages.kind, kind)))
      .get();
  }

  public findByChatAndMessageId(
    chatId: number,
    messageId: number,
    kind?: MatchMessageKind,
  ): MatchMessage | undefined {
    const conditions = [eq(matchMessages.chatId, chatId), eq(matchMessages.messageId, messageId)];
    if (kind !== undefined) conditions.push(eq(matchMessages.kind, kind));

    return this.db.select().from(matchMessages).where(and(...conditions)).get();
  }

  public upsert(input: CreateMatchMessageInput): MatchMessage {
    const record = this.db
      .insert(matchMessages)
      .values({
        matchId: input.matchId,
        kind: input.kind,
        chatId: input.chatId,
        messageId: input.messageId,
        topicId: input.topicId ?? null,
        createdAt: input.createdAt ?? new Date(),
      })
      .onConflictDoUpdate({
        target: [matchMessages.matchId, matchMessages.kind],
        set: {
          chatId: input.chatId,
          messageId: input.messageId,
          topicId: input.topicId ?? null,
        },
      })
      .returning()
      .get();

    if (!record) throw new Error("Match message was not persisted");
    return record;
  }
}

export function createMatchMessagesRepository(db: AppDatabase): MatchMessagesRepository {
  return new MatchMessagesRepository(db);
}
