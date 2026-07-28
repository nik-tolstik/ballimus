import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import type { Bot, Context } from "grammy";

import { createBot, type BotDependencies } from "./bot/create-bot.js";
import { createDatabaseClient } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import {
  createMatchCreationService,
  parseMatchDraftAction,
} from "./application/match-creation.js";
import {
  createMatchEditingService,
  matchEditPromptText,
  parseMatchEditCommand,
} from "./application/match-editing.js";
import { createExternalParticipantService } from "./application/external-participants.js";
import {
  externalParticipantMenuContent,
  parseExternalParticipantAction,
} from "./application/external-participant-actions.js";
import { createUserRenamingService } from "./application/user-renaming.js";
import {
  createMatchActionService,
} from "./application/match-actions.js";
import { MatchActionService } from "./application/match-actions.js";
import {
  adminPanelContent,
  cancellationPromptContent,
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
import {
  OpenMeteoWeatherForecastClient,
} from "./application/weather-forecast.js";
import {
  createWeatherForecastNotificationStore,
  createWeatherForecastScheduler,
} from "./scheduler/weather-forecast-scheduler.js";

export interface MainDependencies {
  createBot?: (config: StartupConfig) => Bot;
}

interface RuntimeLifecycleHooks {
  start(): void;
  stop(): void;
}

const runtimeLifecycleHooks = new WeakMap<Bot, RuntimeLifecycleHooks>();

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

  const matchCreation = createMatchCreationService({
    repositories,
    cardPublisher,
    authorizeCreator: isCommandAuthorized,
    timezone: config.groupTimezone,
  });
  const matchEditing = createMatchEditingService({
    repositories,
    authorizeCreator: isCommandAuthorized,
  });

  const cardUpdater = new MatchCardUpdater(repositories, cardPublisher, config.groupTimezone);
  const matchAction = createMatchActionService({
    repositories,
    notifier,
    refreshCard: (matchId) => cardUpdater.refresh(matchId),
    showCancellationPrompt: async (match) => {
      const adminMessage = repositories.matchMessages.findByMatchIdAndKind(
        match.id,
        "admin_panel",
      );
      if (adminMessage === undefined || cardPublisher.editMessage === undefined) return;

      const content = cancellationPromptContent(match);
      await cardPublisher.editMessage({
        chatId: adminMessage.chatId,
        messageId: adminMessage.messageId,
        text: content.text,
        replyMarkup: content.replyMarkup,
      });
    },
    showEditPrompt: async (match, userId) => {
      await getBot().api.sendMessage(userId, matchEditPromptText(match, config.groupTimezone));
    },
    isAdmin: isCommandAuthorized,
  });
  const externalParticipant = createExternalParticipantService({
    repositories,
    notifier,
    refreshCard: (matchId) => cardUpdater.refresh(matchId),
  });
  const userRenaming = createUserRenamingService({
    userAliases: repositories.userAliases,
    votes: repositories.votes,
    externalParticipants: repositories.externalParticipants,
  });
  const matchInfo = createMatchInfoService(repositories);
  const weatherScheduler = createWeatherForecastScheduler({
    chatId,
    repositories: {
      matches: repositories.matches,
      weatherNotifications: createWeatherForecastNotificationStore(repositories.notifications),
    },
    notifier,
    forecastClient: new OpenMeteoWeatherForecastClient(),
  });

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

  const updateExternalParticipantMenu = async (
    chatId: number,
    messageId: number,
    matchId: number,
    telegramUserId: number,
  ): Promise<void> => {
    const content = externalParticipantMenuContent(
      matchId,
      repositories.externalParticipants.countByMatchIdAndAddedByTelegramUserId(
        matchId,
        telegramUserId,
      ),
    );
    try {
      await getBot().api.editMessageText(chatId, messageId, content.text, {
        reply_markup: content.replyMarkup,
      });
    } catch (error) {
      if (error instanceof Error && /message is not modified/i.test(error.message)) return;
      console.error(`External-player menu update failed (${errorKind(error)}): ${errorDetails(error)}`);
    }
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

        const input = {
          idempotencyKey: String(context.update.update_id),
          chatId,
          generalTopicId,
          timezone: config.groupTimezone,
          creatorTelegramUserId: creator.id,
          draft: parsed.draft,
        };
        if (config.confirmMatchCreation) {
          await matchCreation.createPreview(input);
        } else {
          const result = await matchCreation.create(input);
          await context.reply(`Матч создан: #v${result.match.id}.\nКарточка опубликована в General.`);
        }
      } catch (error) {
        console.error(`Match creation failed (${errorKind(error)}): ${errorDetails(error)}`);
        await context.reply("Не удалось создать матч. Проверьте данные и попробуйте ещё раз.");
      }
    },
    onMatchEdit: async (context) => {
      const creator = context.from;
      if (creator === undefined) {
        await context.reply("Не удалось определить автора команды.");
        return;
      }

      const command = parseMatchEditCommand(messageText(context));
      if (command === undefined) {
        await context.reply(
          "Использование: /editmatch #v32, затем заполните все строки шаблона в том же сообщении.",
        );
        return;
      }

      try {
        const parsed = await getParser().parse(command.matchCommand);
        if (parsed.status === "clarification") {
          await context.reply(clarificationText(parsed));
          return;
        }

        const result = await matchEditing.edit({
          updateId: context.update.update_id,
          chatId,
          matchId: command.matchId,
          editorTelegramUserId: creator.id,
          timezone: config.groupTimezone,
          draft: parsed.draft,
        });
        if (result.status === "updated") {
          await cardUpdater.refresh(result.match.id);
          await context.reply(`Карточка #v${result.match.id} обновлена.`);
          return;
        }
        await context.reply(result.answer);
      } catch (error) {
        console.error(`Match editing failed (${errorKind(error)}): ${errorDetails(error)}`);
        await context.reply("Не удалось обновить матч. Проверьте данные и попробуйте ещё раз.");
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
      const externalAction = callback?.data === undefined
        ? undefined
        : parseExternalParticipantAction(callback.data);
      const draftAction = callback?.data === undefined
        ? undefined
        : parseMatchDraftAction(callback.data);
      const action = callback?.data === undefined
        ? undefined
        : MatchActionService.parseCallbackData(callback.data);
      if (
        callback === undefined ||
        message === undefined ||
        context.from === undefined ||
        (draftAction === undefined && action === undefined && externalAction === undefined)
      ) {
        await context.answerCallbackQuery("Это действие больше недоступно");
        return;
      }

      if (externalAction !== undefined) {
        const match = repositories.matches.findById(externalAction.matchId);
        if (match === undefined) {
          await context.api.answerCallbackQuery(callback.id, {
            text: "Матч не найден",
            show_alert: true,
          });
          return;
        }
        if (match.status !== "active" && match.status !== "confirmed") {
          await context.api.answerCallbackQuery(callback.id, {
            text: "Матч больше недоступен",
            show_alert: true,
          });
          return;
        }

        if (externalAction.kind === "menu") {
          const publicMessage = repositories.matchMessages.findByChatAndMessageId(
            message.chat.id,
            message.message_id,
            "public_card",
          );
          if (publicMessage === undefined || publicMessage.matchId !== externalAction.matchId) {
            await context.api.answerCallbackQuery(callback.id, {
              text: "Это сообщение матча больше не актуально",
              show_alert: true,
            });
            return;
          }

          const content = externalParticipantMenuContent(
            match.id,
            repositories.externalParticipants.countByMatchIdAndAddedByTelegramUserId(
              match.id,
              context.from.id,
            ),
          );
          try {
            await getBot().api.sendMessage(context.from.id, content.text, {
              reply_markup: content.replyMarkup,
            });
          } catch (error) {
            console.error(`External-player private menu failed (${errorKind(error)}): ${errorDetails(error)}`);
            await context.api.answerCallbackQuery(callback.id, {
              text: "Сначала откройте личный чат с ботом и нажмите /start",
              show_alert: true,
            });
            return;
          }
          await context.api.answerCallbackQuery(callback.id, {
            text: "Меню отправлено в личные сообщения",
          });
          return;
        }

        if (message.chat.type !== "private") {
          await context.api.answerCallbackQuery(callback.id, {
            text: "Откройте меню дополнительных игроков в личном чате",
            show_alert: true,
          });
          return;
        }

        const displayName = userRenaming.resolveDisplayName({
          telegramUserId: context.from.id,
          username: context.from.username ?? null,
          fallback: participantDisplayName(context),
        });
        try {
          const result = await externalParticipant.add({
            matchId: match.id,
            updateId: context.update.update_id,
            addedByTelegramUserId: context.from.id,
            quantity: externalAction.kind === "add" ? 1 : -1,
            sourceLabel: null,
            displayNameSnapshot: displayName,
            removeOnlyOwn: true,
          });
          if (result.status === "ignored") {
            const answer = result.reason === "duplicate_update"
              ? "Это действие уже обработано"
              : result.reason === "insufficient_external_players"
                ? "У вас нет добавленных вами игроков для удаления"
                : result.reason === "inactive_match"
                  ? "Матч больше недоступен"
                  : result.reason === "unknown_match"
                    ? "Матч не найден"
                    : "Не удалось изменить дополнительных игроков";
            await context.api.answerCallbackQuery(callback.id, {
              text: answer,
              show_alert: result.reason !== "duplicate_update",
            });
            return;
          }

          await updateExternalParticipantMenu(
            message.chat.id,
            message.message_id,
            match.id,
            context.from.id,
          );
          const actionText = externalAction.kind === "add" ? "Добавлен 1 игрок" : "Убран 1 игрок";
          await context.api.answerCallbackQuery(callback.id, {
            text: `${actionText}. У вас: ${repositories.externalParticipants.countByMatchIdAndAddedByTelegramUserId(
              match.id,
              context.from.id,
            )}`,
          });
        } catch (error) {
          console.error(`External-player callback failed (${errorKind(error)}): ${errorDetails(error)}`);
          await context.api.answerCallbackQuery(callback.id, {
            text: "Не удалось изменить количество дополнительных игроков",
            show_alert: true,
          });
        }
        return;
      }

      if (draftAction !== undefined) {
        try {
          const result = await matchCreation.processPreviewAction({
            telegramUserId: context.from.id,
            chatId: message.chat.id,
            messageId: message.message_id,
            generalTopicId,
            action: draftAction,
          });
          await context.api.answerCallbackQuery(callback.id, { text: result.answer });
        } catch (error) {
          console.error(`Match draft action failed (${errorKind(error)}): ${errorDetails(error)}`);
          await context.api.answerCallbackQuery(callback.id, {
            text: "Не удалось обработать черновик",
            show_alert: true,
          });
        }
        return;
      }

      if (action === undefined) {
        await context.answerCallbackQuery("Это действие больше недоступно");
        return;
      }

      const update: MatchCallbackUpdate = {
        updateId: context.update.update_id,
        callbackQueryId: callback.id,
        telegramUserId: context.from.id,
        username: context.from.username ?? null,
        displayName: userRenaming.resolveDisplayName({
          telegramUserId: context.from.id,
          username: context.from.username ?? null,
          fallback: participantDisplayName(context),
        }),
        chatId: message.chat.id,
        messageId: message.message_id,
        action,
      };

      try {
        const result = await matchAction.process(update);
        await context.api.answerCallbackQuery(
          callback.id,
          result.answer === undefined ? {} : { text: result.answer },
        );
      } catch (error) {
        console.error(`Match action failed (${errorKind(error)}): ${errorDetails(error)}`);
        await context.api.answerCallbackQuery(callback.id, {
          text: "Не удалось обработать действие",
          show_alert: true,
        });
      }
    },
    onRenameUser: async (context, command) => {
      try {
        const result = userRenaming.rename(command);
        await Promise.all(result.affectedMatchIds.map((matchId) => cardUpdater.refresh(matchId)));
        await context.reply(
          `Для @${command.username} закреплено имя «${command.displayName}».` +
            (result.affectedMatchIds.length === 0
              ? " Новые голосования будут использовать это имя."
              : " Списки голосований обновлены."),
        );
      } catch (error) {
        console.error(`User renaming failed (${errorKind(error)}): ${errorDetails(error)}`);
        await context.reply("Не удалось закрепить имя пользователя. Попробуйте ещё раз.");
      }
    },
  };

  const bot = createBot(config, dependencies);
  botRef.current = bot;
  runtimeLifecycleHooks.set(bot, weatherScheduler);
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
  const lifecycleHooks = runtimeLifecycleHooks.get(bot);
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      lifecycleHooks?.stop();
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
        lifecycleHooks?.start();
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
    console.error(`Football Bot startup failed (${errorKind(error)}): ${errorDetails(error)}`);
    process.exitCode = 1;
  });
}
