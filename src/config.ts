export type Environment = Readonly<Record<string, string | undefined>>;

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Telegram settings that are safe to load before startup validation.
 *
 * Topic settings are optional because the configuration loader is also used by
 * tests and by tooling that does not connect to Telegram. The bot token is
 * deliberately optional here and is required by validateStartupConfig.
 */
export interface TelegramConfig {
  botToken?: string;
  chatId?: number;
  chatTopicId?: number;
  generalTopicId?: number;
  statusUserId?: number;
}

export interface OpenRouterConfig {
  apiKey?: string;
  model: string;
}

export interface AppConfig {
  telegram: TelegramConfig;
  openrouter: OpenRouterConfig;
  databaseUrl: string;
  groupTimezone: string;
  defaultPlayersNeeded: number;
  confirmMatchCreation: boolean;
  logLevel: LogLevel;
}

export type StartupConfig = Omit<AppConfig, "telegram"> & {
  telegram: Omit<TelegramConfig, "botToken"> & { botToken: string };
};

export class ConfigurationError extends Error {
  readonly variables: readonly string[];

  constructor(message: string, variables: readonly string[] = []) {
    super(message);
    this.name = "ConfigurationError";
    this.variables = variables;
  }
}

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_DATABASE_URL = "file:./data/football-bot.db";
const DEFAULT_GROUP_TIMEZONE = "Europe/Minsk";
const DEFAULT_PLAYERS_NEEDED = 10;
const DEFAULT_CONFIRM_MATCH_CREATION = false;
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function optionalString(environment: Environment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value === "" ? undefined : value;
}

function optionalInteger(environment: Environment, name: string): number | undefined {
  const value = optionalString(environment, name);
  if (value === undefined) return undefined;

  if (!/^-?\d+$/.test(value)) {
    throw new ConfigurationError(`${name} must be an integer`, [name]);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConfigurationError(`${name} must be a safe integer`, [name]);
  }

  return parsed;
}

function requiredPositiveInteger(environment: Environment, name: string, fallback: number): number {
  const value = optionalString(environment, name);
  if (value === undefined) return fallback;

  const parsed = optionalInteger(environment, name);
  if (parsed === undefined || parsed <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer`, [name]);
  }

  return parsed;
}

function booleanWithDefault(environment: Environment, name: string, fallback: boolean): boolean {
  const value = optionalString(environment, name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;

  throw new ConfigurationError(`${name} must be either true or false`, [name]);
}

function validateTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ConfigurationError("GROUP_TIMEZONE must be a valid IANA timezone", ["GROUP_TIMEZONE"]);
  }

  return timezone;
}

function readChatId(environment: Environment): number | undefined {
  return optionalInteger(environment, "TELEGRAM_CHAT_ID") ?? optionalInteger(environment, "TELEGRAM_GROUP_CHAT_ID");
}

/**
 * Loads typed configuration without requiring a Telegram token.
 *
 * This function performs parsing and validation of supplied values, but token
 * presence is checked only by validateStartupConfig when the bot is started.
 */
export function loadConfig(environment: Environment = process.env): AppConfig {
  const model = optionalString(environment, "OPENROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL;
  const databaseUrl = optionalString(environment, "DATABASE_URL") ?? DEFAULT_DATABASE_URL;
  const groupTimezone = validateTimezone(
    optionalString(environment, "GROUP_TIMEZONE") ?? DEFAULT_GROUP_TIMEZONE,
  );
  const logLevelValue = optionalString(environment, "LOG_LEVEL") ?? DEFAULT_LOG_LEVEL;

  if (!LOG_LEVELS.includes(logLevelValue as LogLevel)) {
    throw new ConfigurationError("LOG_LEVEL must be one of debug, info, warn, or error", ["LOG_LEVEL"]);
  }

  const telegram: TelegramConfig = {};
  const botToken = optionalString(environment, "TELEGRAM_BOT_TOKEN");
  const chatId = readChatId(environment);
  const chatTopicId = optionalInteger(environment, "TELEGRAM_CHAT_TOPIC_ID");
  const generalTopicId = optionalInteger(environment, "TELEGRAM_GENERAL_TOPIC_ID");
  const statusUserId = optionalInteger(environment, "TELEGRAM_STATUS_USER_ID");

  if (botToken !== undefined) telegram.botToken = botToken;
  if (chatId !== undefined) telegram.chatId = chatId;
  if (chatTopicId !== undefined) telegram.chatTopicId = chatTopicId;
  if (generalTopicId !== undefined) telegram.generalTopicId = generalTopicId;
  if (statusUserId !== undefined) telegram.statusUserId = statusUserId;

  const apiKey = optionalString(environment, "OPENROUTER_API_KEY");
  const config: AppConfig = {
    telegram,
    openrouter: { model },
    databaseUrl,
    groupTimezone,
    defaultPlayersNeeded: requiredPositiveInteger(
      environment,
      "DEFAULT_PLAYERS_NEEDED",
      DEFAULT_PLAYERS_NEEDED,
    ),
    confirmMatchCreation: booleanWithDefault(
      environment,
      "CONFIRM_MATCH_CREATION",
      DEFAULT_CONFIRM_MATCH_CREATION,
    ),
    logLevel: logLevelValue as LogLevel,
  };

  if (apiKey !== undefined) config.openrouter.apiKey = apiKey;

  return config;
}

/**
 * Validates configuration at the explicit startup boundary.
 *
 * Error messages identify missing setting names only; secret values are never
 * included in thrown errors or logs.
 */
export function validateStartupConfig(config: AppConfig): StartupConfig {
  const botToken = config.telegram.botToken;
  if (botToken === undefined) {
    throw new ConfigurationError("Missing required configuration: TELEGRAM_BOT_TOKEN", ["TELEGRAM_BOT_TOKEN"]);
  }

  return {
    ...config,
    telegram: {
      ...config.telegram,
      botToken,
    },
  };
}

export const validateConfig = validateStartupConfig;
