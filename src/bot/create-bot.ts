import { Bot, type Context, type MiddlewareFn } from "grammy";
import type { Message } from "grammy/types";

import {
  parseRenameUserCommand,
  RENAME_USER_USAGE,
  type RenameUserCommand,
} from "../application/user-renaming.js";
import {
  parseRemoveVoteCommand,
  REMOVE_VOTE_USAGE,
  type RemoveVoteCommand,
} from "../application/vote-removal.js";
import {
  type AppConfig,
  type StartupConfig,
  type TelegramConfig,
  validateStartupConfig,
} from "../config.js";

export interface GeneralTopicSender {
  send(text: string): Promise<Message.TextMessage>;
}

export interface BotDependencies {
  onMatch?: (ctx: Context) => void | Promise<void>;
  onMatchEdit?: (ctx: Context) => void | Promise<void>;
  onMatchInfo?: (ctx: Context) => void | Promise<void>;
  onRemoveVote?: (ctx: Context, command: RemoveVoteCommand) => void | Promise<void>;
  onRenameUser?: (ctx: Context, command: RenameUserCommand) => void | Promise<void>;
  onCallbackQuery?: (ctx: Context) => void | Promise<void>;
  isCommandAuthorized?: (telegramUserId: number) => boolean | Promise<boolean>;
}

export const HELP_TEXT = [
  "/help — показать эту справку.",
  "/match — создать матч и опубликовать карточку в теме general.",
  "/editmatch #v32 — изменить опубликованный матч.",
  "/matchinfo [#v32] — показать участников и дополнительных игроков.",
  "/remove_vote #v32 @username — убрать голос игрока.",
  "/rename_user @username Имя — закрепить понятное имя пользователя.",
  "Кнопка «Доп. игроки» в карточке — открыть меню дополнительных игроков.",
].join("\n");

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function generalTopicTarget(config: TelegramConfig): { chatId: number; topicId: number } {
  if (config.chatId === undefined || config.generalTopicId === undefined) {
    throw new Error(
      "General-topic sending requires TELEGRAM_CHAT_ID and TELEGRAM_GENERAL_TOPIC_ID",
    );
  }

  return { chatId: config.chatId, topicId: config.generalTopicId };
}

export function createPrivateCommandMiddleware(
  isCommandAuthorized?: (telegramUserId: number) => boolean | Promise<boolean>,
): MiddlewareFn<Context> {
  return async (context: Context, next): Promise<void> => {
    if (context.chat?.type !== "private" || isCommandAuthorized === undefined) return;

    const telegramUserId = context.from?.id;
    if (telegramUserId !== undefined && (await isCommandAuthorized(telegramUserId))) {
      await next();
    }
  };
}

/**
 * Creates a sender that can only target the configured general topic.
 * Callers cannot override the chat or topic ID through this abstraction.
 */
export function createGeneralTopicSender(
  bot: Bot,
  config: Pick<TelegramConfig, "chatId" | "generalTopicId">,
): GeneralTopicSender {
  const target = generalTopicTarget(config);

  return {
    send: (text: string) =>
      bot.api.sendMessage(
        target.chatId,
        text,
        target.topicId === 1 ? {} : { message_thread_id: target.topicId },
      ),
  };
}

export function sendToGeneralTopic(
  bot: Bot,
  config: Pick<TelegramConfig, "chatId" | "generalTopicId">,
  text: string,
): Promise<Message.TextMessage> {
  return createGeneralTopicSender(bot, config).send(text);
}

/**
 * Builds the bot and registers only foundation handlers. Match parsing and
 * card publication are intentionally injected by application services.
 */
export function createBot(
  config: AppConfig | StartupConfig,
  dependencies: BotDependencies = {},
): Bot {
  const startupConfig = validateStartupConfig(config);
  const bot = new Bot(startupConfig.telegram.botToken);

  bot.catch(({ error }) => {
    console.error(`Telegram update handling failed (${errorKind(error)}).`);
  });

  const privateCommandMiddleware = createPrivateCommandMiddleware(
    dependencies.isCommandAuthorized,
  );

  bot.command("help", privateCommandMiddleware, async (context) => {
    await context.reply(HELP_TEXT);
  });

  bot.command("match", privateCommandMiddleware, async (context) => {
    if (dependencies.onMatch !== undefined) {
      await dependencies.onMatch(context);
      return;
    }

    await context.reply("Команда /match принята. Укажите дату, время и место матча.");
  });

  bot.command("editmatch", privateCommandMiddleware, async (context) => {
    if (dependencies.onMatchEdit !== undefined) {
      await dependencies.onMatchEdit(context);
      return;
    }

    await context.reply("Использование: /editmatch #v32, затем заполните данные матча.");
  });

  bot.command("matchinfo", privateCommandMiddleware, async (context) => {
    if (dependencies.onMatchInfo !== undefined) {
      await dependencies.onMatchInfo(context);
      return;
    }

    await context.reply("Команда /matchinfo принята.");
  });

  bot.command("remove_vote", privateCommandMiddleware, async (context) => {
    const command = parseRemoveVoteCommand(context.msg?.text ?? "");
    if (command === undefined) {
      await context.reply(REMOVE_VOTE_USAGE);
      return;
    }

    if (dependencies.onRemoveVote !== undefined) {
      await dependencies.onRemoveVote(context, command);
      return;
    }

    await context.reply("Команда /remove_vote принята.");
  });

  bot.command("rename_user", privateCommandMiddleware, async (context) => {
    const command = parseRenameUserCommand(context.msg?.text ?? "");
    if (command === undefined) {
      await context.reply(RENAME_USER_USAGE);
      return;
    }

    if (dependencies.onRenameUser !== undefined) {
      await dependencies.onRenameUser(context, command);
      return;
    }

    await context.reply("Команда /rename_user принята.");
  });

  bot.on("callback_query:data", async (context) => {
    if (dependencies.onCallbackQuery === undefined) return;
    await dependencies.onCallbackQuery(context);
  });

  return bot;
}
