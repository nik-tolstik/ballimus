import { Bot, type Context, type MiddlewareFn } from "grammy";
import type { Message } from "grammy/types";

import {
  parseExternalParticipantCommand,
  type ExternalParticipantCommand,
} from "../application/external-participants.js";
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
  onMatchInfo?: (ctx: Context) => void | Promise<void>;
  onCallbackQuery?: (ctx: Context) => void | Promise<void>;
  onExternalParticipant?: (
    ctx: Context,
    command: ExternalParticipantCommand,
  ) => void | Promise<void>;
  isCommandAuthorized?: (telegramUserId: number) => boolean | Promise<boolean>;
}

export const HELP_TEXT = [
  "/help — показать эту справку.",
  "/match — создать матч и опубликовать карточку в теме general.",
  "/matchinfo [#v32] — показать участников и дополнительных игроков.",
  "@бот +/-N для #v32 — добавить или убрать N внешних игроков.",
  "@бот от Никиты +N игрока для #v32 — учесть игроков от указанного человека.",
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

  bot.command("matchinfo", privateCommandMiddleware, async (context) => {
    if (dependencies.onMatchInfo !== undefined) {
      await dependencies.onMatchInfo(context);
      return;
    }

    await context.reply("Команда /matchinfo принята.");
  });

  bot.on("message:text", privateCommandMiddleware, async (context) => {
    const command = parseExternalParticipantCommand(context.msg.text, context.me.username);
    if (command === undefined || dependencies.onExternalParticipant === undefined) return;
    await dependencies.onExternalParticipant(context, command);
  });

  bot.on("callback_query:data", async (context) => {
    if (dependencies.onCallbackQuery === undefined) return;
    await dependencies.onCallbackQuery(context);
  });

  return bot;
}
