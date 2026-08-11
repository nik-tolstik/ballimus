import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  TelegramPollsRepository,
  type AppDatabase,
  type TelegramPoll,
  type TelegramPollUpdateOptionInput,
} from "@football/db";
import { GrammyError } from "grammy";

import { APP_DATABASE } from "../database/database.constants.js";
import { TelegramEffects, type TelegramSentPoll } from "./telegram-effects.js";

export interface TelegramPollPublicationRepository {
  getById(id: bigint): Promise<TelegramPoll>;
  markPublished(
    id: bigint,
    telegramPollId: string,
    telegramMessageId: bigint,
    options: readonly TelegramPollUpdateOptionInput[],
    attemptedAt?: Date,
  ): Promise<TelegramPoll>;
  markPublicationFailed(id: bigint, error: string, attemptedAt?: Date): Promise<TelegramPoll>;
  markPublicationUncertain(id: bigint, error: string, attemptedAt?: Date): Promise<TelegramPoll>;
  markPublicationCancelled(id: bigint, attemptedAt?: Date): Promise<TelegramPoll>;
}

export interface TelegramPollSender {
  sendPoll(input: Parameters<TelegramEffects["sendPoll"]>[0]): Promise<TelegramSentPoll>;
}

function definiteFailureMessage(error: GrammyError): string {
  const description = error.description.trim();
  return description === "" ? "Telegram rejected the poll." : `Telegram rejected the poll: ${description}`;
}

/** Makes one bounded native-poll publication attempt and always persists a terminal outcome. */
@Injectable()
export class TelegramPollPublicationService {
  private readonly polls: TelegramPollPublicationRepository;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(TelegramEffects) private readonly sender: TelegramPollSender,
    @Optional() polls?: TelegramPollPublicationRepository,
  ) {
    this.polls = polls ?? new TelegramPollsRepository(db);
  }

  public async publishPending(pollId: bigint): Promise<TelegramPoll> {
    const poll = await this.polls.getById(pollId);
    if (poll.publicationState !== "pending") return poll;
    const attemptedAt = new Date();
    if (poll.archivedAt !== null) return this.polls.markPublicationCancelled(poll.id, attemptedAt);

    try {
      const sent = await this.sender.sendPoll({
        chatId: poll.telegramChatId,
        ...(poll.telegramTopicId === null ? {} : { messageThreadId: poll.telegramTopicId }),
        question: poll.question,
        options: poll.options.map((option) => option.text),
        isAnonymous: poll.isAnonymous,
        allowsMultipleAnswers: poll.allowsMultipleAnswers,
        allowsRevoting: poll.allowsRevoting,
      });
      return this.polls.markPublished(poll.id, sent.pollId, sent.messageId, sent.options, attemptedAt);
    } catch (error) {
      if (error instanceof GrammyError) {
        return this.polls.markPublicationFailed(poll.id, definiteFailureMessage(error), attemptedAt);
      }
      return this.polls.markPublicationUncertain(
        poll.id,
        "Telegram did not confirm poll publication. Check General before republishing.",
        attemptedAt,
      );
    }
  }
}
