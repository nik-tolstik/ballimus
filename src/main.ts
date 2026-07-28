import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import type { Bot, Context } from "grammy";

import { createBot, type BotDependencies } from "./bot/create-bot.js";
import { createDatabaseClient } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import { createMatchCreationService } from "./application/match-creation.js";
import { createExternalParticipantService } from "./application/external-participants.js";
import {
  createMatchActionService,
} from "./application/match-actions.js";
import { MatchActionService } from "./application/match-actions.js";
import {
  adminPanelContent,
  type MatchCallbackUpdate,
} from "./application/match-card.js";
import { MatchCardUpdater } from "./application/match-card-updater.js";
import type { Match } from "./db/schema.js";
import type { MatchCardPublisher } from "./application/match-creation.js";
import {
  createMatchInfoService,
  formatMatchInfo,
  parseMatchInfoMatchId,
} from "./application/match-info.js";
import {
  createMatchParser,
  type MatchParseResult,
  type MatchParserOptions,
} from "./parser/match-parser.js";
import {
  loadConfig,
  type Environment,
  type StartupConfig,
  validateStartupConfig,
  type AppConfig,
} from "./config.js";

export interface MainDependencies {
  createBot?: (config: StartupConfig) => Bot;
}

function messageText(context: Context): string {
  return context.msg?.text ?? "";
}

function clarificationText(result: MatchParseResult): string {
  return result.status === "clarification" ? result.message : "";
}

const BOT_STARTED_NOTIFICATION = "🤖 Бот запущен и готов к работе.";
const BOT_STOPPED_NOTIFICATION = "🤖 Бот остановлен.";

async function sendLifecycleNotification(
  bot: Bot,
  config: StartupConfig,
  text: string,
): Promise<void> {
  const statusUserId = config.telegram.statusUserId;
  if (statusUserId === undefined) return;

  try {
    await bot.api.sendMessage(statusUserId, text);
  } catch (error) {
    console.error(`Lifecycle notification failed (${errorKind(error)}): ${errorDetails(error)}`);
  }
}

function createRuntimeBot(config: StartupConfig): Bot {
  if (
    config.telegram.chatId === undefined ||
    config.telegram.chatTopicId === undefined ||
    config.telegram.generalTopicId === undefined ||
    config.telegram.statusUserId === undefined
  ) {
    throw new Error(
      "TELEGRAM_CHAT_ID, TELEGRAM_CHAT_TOPIC_ID, TELEGRAM_GENERAL_TOPIC_ID, and TELEGRAM_STATUS_USER_ID are required for the MVP runtime",
    );
  }

  const chatId = config.telegram.chatId;
  const chatTopicId = config.telegram.chatTopicId;
  const generalTopicId = config.telegram.generalTopicId;

  const database = createDatabaseClient({ url: config.databaseUrl, migrate: true });
  const repositories = createRepositories(database.db);
  repositories.chatSettings.upsert({
    chatId,
    generalTopicId,
    chatTopicId,
    timezone: config.groupTimezone,
    defaultThreshold: config.defaultPlayersNeeded,
  });

  const botRef: { current?: Bot } = {};
  const getBot = (): Bot => {
    if (botRef.current === undefined) throw new Error("Telegram bot is not initialized");
    return botRef.current;
  };

  const cardPublisher: MatchCardPublisher = {
    sendPublicCard: async (request) => {
      const response = await getBot().api.sendMessage(
        request.chatId,
        request.text,
        {
          ...(request.topicId === 1 ? {} : { message_thread_id: request.topicId }),
          parse_mode: "HTML",
          ...(request.replyMarkup === undefined ? {} : { reply_markup: request.replyMarkup }),
        },
      );
      return { messageId: response.message_id };
    },
    sendAdminPanel: async (request) => {
      const response = await getBot().api.sendMessage(request.userId, request.text, {
        parse_mode: "HTML",
        ...(request.replyMarkup === undefined ? {} : { reply_markup: request.replyMarkup }),
      });
      return { messageId: response.message_id };
    },
    editMessage: async (request) => {
      await getBot().api.editMessageText(request.chatId, request.messageId, request.text, {
        parse_mode: "HTML",
        reply_markup: request.replyMarkup ?? { inline_keyboard: [] },
      });
    },
    deleteMessage: async (request) => {
      await getBot().api.deleteMessage(request.chatId, request.messageId);
    },
  };

  let parser: ReturnType<typeof createMatchParser> | undefined;
  const getParser = () => {
    const parserOptions: MatchParserOptions =
      config.openrouter.apiKey === undefined
        ? {
            timezone: config.groupTimezone,
            model: config.openrouter.model,
            defaultRequiredPlayers: config.defaultPlayersNeeded,
          }
        : {
            timezone: config.groupTimezone,
            apiKey: config.openrouter.apiKey,
            model: config.openrouter.model,
            defaultRequiredPlayers: config.defaultPlayersNeeded,
          };
    parser ??= createMatchParser(parserOptions);
    return parser;
  };

  const matchCreation = createMatchCreationService({
    repositories,
    cardPublisher,
  });

  const notifier = {
    send: async (text: string) => {
      await getBot().api.sendMessage(chatId, text, {
        message_thread_id: chatTopicId,
        parse_mode: "HTML",
      });
    },
  };

  const isCommandAuthorized = async (telegramUserId: number): Promise<boolean> => {
    try {
      const member = await getBot().api.getChatMember(chatId, telegramUserId);
      return member.status === "administrator" || member.status === "creator";
    } catch {
      return false;
    }
  };

  const cardUpdater = new MatchCardUpdater(repositories, cardPublisher);
  const matchAction = createMatchActionService({
    repositories,
    notifier,
    refreshCard: (matchId) => cardUpdater.refresh(matchId),
    isAdmin: isCommandAuthorized,
  });
  const externalParticipant = createExternalParticipantService({
    repositories,
    notifier,
    refreshCard: (matchId) => cardUpdater.refresh(matchId),
  });
  const matchInfo = createMatchInfoService(repositories);

  const participantDisplayName = (context: Context): string => {
    const user = context.from;
    if (user === undefined) return "Игрок";
    const name = [user.first_name, user.last_name]
      .filter((part): part is string => part !== undefined && part.trim() !== "")
      .join(" ")
      .trim();
    return name || "Игрок";
  };

  const sendAdminPanel = async (match: Match, userId: number): Promise<void> => {
    const content = adminPanelContent(match);
    const message = await cardPublisher.sendAdminPanel({
      userId,
      text: content.text,
      replyMarkup: content.replyMarkup,
    });
    repositories.matchMessages.upsert({
      matchId: match.id,
      kind: "admin_panel",
      chatId: userId,
      messageId: message.messageId,
      topicId: null,
    });
  };

  const dependencies: BotDependencies = {
    isCommandAuthorized,
    onMatch: async (context) => {
      const creator = context.from;
      if (creator === undefined) {
        await context.reply("Не удалось определить автора команды.");
        return;
      }

      try {
        const parsed = await getParser().parse(messageText(context));
        if (parsed.status === "clarification") {
          await context.reply(clarificationText(parsed));
          return;
        }

        const result = await matchCreation.create({
          idempotencyKey: String(context.update.update_id),
          chatId,
          generalTopicId,
          timezone: config.groupTimezone,
          creatorTelegramUserId: creator.id,
          draft: parsed.draft,
        });
        await context.reply(`✅ Матч создан: #v${result.match.id}.\nКарточка опубликована в General.`);
      } catch (error) {
        console.error(`Match creation failed (${errorKind(error)}): ${errorDetails(error)}`);
        await context.reply("Не удалось создать матч. Проверьте данные и попробуйте ещё раз.");
      }
    },
    onMatchInfo: async (context) => {
      const matchId = parseMatchInfoMatchId(messageText(context));
      if (matchId === null) {
        await context.reply("Использование: /matchinfo или /matchinfo #v32");
        return;
      }

      const result = matchInfo.get(
        matchId === undefined ? { chatId } : { chatId, matchId },
      );
      if (result.status === "found") {
        await context.reply(formatMatchInfo(result, config.groupTimezone));
        if (context.from?.id === result.match.creatorTelegramUserId) {
          try {
            await sendAdminPanel(result.match, context.from.id);
          } catch (error) {
            console.error(`Admin panel restoration failed (${errorKind(error)}): ${errorDetails(error)}`);
          }
        }
        return;
      }
      if (result.reason === "no_active_match") {
        await context.reply("Активных матчей не найдено. Укажите конкретный матч: /matchinfo #v32");
        return;
      }
      if (result.reason === "multiple_active_matches") {
        const references = result.activeMatchIds?.map((id) => `#v${id}`).join(", ") ?? "";
        await context.reply(`Найдено несколько активных матчей: ${references}. Укажите один: /matchinfo #v<ID>`);
        return;
      }
      await context.reply(`Матч #v${matchId ?? ""} не найден.`);
    },
    onCallbackQuery: async (context) => {
      const callback = context.callbackQuery;
      const message = callback?.message;
      const action = callback?.data === undefined
        ? undefined
        : MatchActionService.parseCallbackData(callback.data);
      if (callback === undefined || message === undefined || action === undefined || context.from === undefined) {
        await context.answerCallbackQuery("Это действие больше недоступно");
        return;
      }

      const update: MatchCallbackUpdate = {
        updateId: context.update.update_id,
        callbackQueryId: callback.id,
        telegramUserId: context.from.id,
        username: context.from.username ?? null,
        displayName: participantDisplayName(context),
        chatId: message.chat.id,
        messageId: message.message_id,
        action,
      };

      try {
        const result = await matchAction.process(update);
        await context.api.answerCallbackQuery(callback.id, { text: result.answer });
      } catch (error) {
        console.error(`Match action failed (${errorKind(error)}): ${errorDetails(error)}`);
        await context.api.answerCallbackQuery(callback.id, {
          text: "Не удалось обработать действие",
          show_alert: true,
        });
      }
    },
    onExternalParticipant: async (context, command) => {
      const user = context.from;
      if (user === undefined) {
        await context.reply("Не удалось определить автора сообщения.");
        return;
      }

      try {
        const result = await externalParticipant.add({
          matchId: command.matchId,
          updateId: context.update.update_id,
          addedByTelegramUserId: user.id,
          quantity: command.quantity,
        });
        if (result.status === "ignored" && result.reason === "unknown_match") {
          await context.reply(`Матч #v${command.matchId} не найден.`);
        } else if (result.status === "ignored" && result.reason === "inactive_match") {
          await context.reply(`Матч #v${command.matchId} больше недоступен.`);
        } else if (
          result.status === "ignored" &&
          result.reason === "insufficient_external_players"
        ) {
          const externalCount = repositories.externalParticipants.countByMatchId(command.matchId);
          await context.reply(
            `Нельзя убрать столько внешних игроков. Сейчас дополнительных игроков: ${externalCount}.`,
          );
        } else if (result.status === "added") {
          const action = command.quantity > 0 ? "Добавлено" : "Убрано";
          await context.reply(
            `✅ ${action} ${Math.abs(command.quantity)} внешних игроков.\n` +
              `Дополнительных игроков сейчас: ${result.externalCount}.\n` +
              `Всего участников: ${result.goingCount}.`,
          );
        }
      } catch (error) {
        console.error(
          `External participant addition failed (${errorKind(error)}): ${errorDetails(error)}`,
        );
        await context.reply("Не удалось изменить количество дополнительных игроков. Попробуйте ещё раз.");
      }
    },
  };

  const bot = createBot(config, dependencies);
  botRef.current = bot;
  return bot;
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorDetails(error: unknown): string {
  const messages: string[] = [];
  if (error instanceof Error) {
    messages.push(error.message);
    if (error.cause instanceof Error) messages.push(`cause: ${error.cause.message}`);
  } else {
    messages.push(String(error));
  }

  const message = messages.join("; ");
  return message
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/gu, "[redacted-token]")
    .replace(/\bsk-or-v1-[A-Za-z0-9_-]+\b/gu, "[redacted-key]")
    .slice(0, 500);
}

export async function startBot(
  config: AppConfig,
  dependencies: MainDependencies = {},
): Promise<void> {
  const startupConfig = validateStartupConfig(config);
  const bot = dependencies.createBot?.(startupConfig) ?? createRuntimeBot(startupConfig);
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      await sendLifecycleNotification(bot, startupConfig, BOT_STOPPED_NOTIFICATION);
      await bot.stop();
    })();
    return stopPromise;
  };
  const handleSignal = (): void => {
    void stop();
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: async () => {
        console.info("Football Bot started with Telegram long polling.");
        await sendLifecycleNotification(bot, startupConfig, BOT_STARTED_NOTIFICATION);
      },
    });
  } finally {
    await stop();
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}

export async function main(
  environment: Environment = process.env,
  dependencies: MainDependencies = {},
): Promise<void> {
  await startBot(loadConfig(environment), dependencies);
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && fileURLToPath(import.meta.url) === resolve(entryPoint);
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    console.error(`Football Bot startup failed (${errorKind(error)}).`);
    process.exitCode = 1;
  });
}
