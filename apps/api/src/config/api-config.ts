import { registerAs } from "@nestjs/config";

export const API_CONFIG_NAMESPACE = "api" as const;
export const API_CONFIG = Symbol("API_CONFIG");
export const DEFAULT_GROUP_TIMEZONE = "Europe/Minsk" as const;
export const DEFAULT_LOG_LEVEL = "info" as const;
export const DEFAULT_PORT = 6000;
export const DEFAULT_MINI_APP_INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export const API_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type ApiLogLevel = (typeof API_LOG_LEVELS)[number];

export interface ApiConfig {
  readonly databaseUrl: string;
  readonly telegramBotToken: string;
  readonly telegramWebhookSecret: string;
  readonly telegramOwnerUserId: bigint;
  readonly telegramGroupChatId: bigint;
  readonly telegramGeneralTopicId: bigint;
  readonly telegramChatTopicId: bigint;
  readonly telegramMiniAppUrl: string;
  readonly webOrigin: string;
  readonly groupTimezone: string;
  readonly logLevel: ApiLogLevel;
  readonly port: number;
  readonly miniAppInitDataMaxAgeSeconds: number;
}

export type ApiEnvironment = Readonly<Record<string, unknown>>;

export interface ApiConfigOptions {
  readonly miniAppInitDataMaxAgeSeconds?: number;
}

export class ApiConfigurationError extends Error {
  readonly variables: readonly string[];

  constructor(message: string, variables: readonly string[] = []) {
    super(message);
    this.name = "ApiConfigurationError";
    this.variables = variables;
  }
}

function readString(environment: ApiEnvironment, name: string): string | undefined {
  const value = environment[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiConfigurationError(`${name} must be a string`, [name]);
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function requiredString(environment: ApiEnvironment, name: string): string {
  const value = readString(environment, name);
  if (value === undefined) {
    throw new ApiConfigurationError(`Missing required API configuration: ${name}`, [name]);
  }

  return value;
}

function parseInteger(environment: ApiEnvironment, name: string): bigint | undefined {
  const value = readString(environment, name);
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) {
    throw new ApiConfigurationError(`${name} must be an integer`, [name]);
  }

  try {
    return BigInt(value);
  } catch {
    throw new ApiConfigurationError(`${name} must be an integer`, [name]);
  }
}

function requiredInteger(
  environment: ApiEnvironment,
  name: string,
  requirement: "positive" | "nonZero" | "any",
): bigint {
  const value = parseInteger(environment, name);
  if (value === undefined) {
    throw new ApiConfigurationError(`Missing required API configuration: ${name}`, [name]);
  }

  if (requirement === "positive" && value <= 0n) {
    throw new ApiConfigurationError(`${name} must be positive`, [name]);
  }
  if (requirement === "nonZero" && value === 0n) {
    throw new ApiConfigurationError(`${name} must not be zero`, [name]);
  }

  return value;
}

function parsePort(environment: ApiEnvironment): number {
  const value = readString(environment, "PORT");
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(value)) {
    throw new ApiConfigurationError("PORT must be an integer between 1 and 65535", ["PORT"]);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ApiConfigurationError("PORT must be an integer between 1 and 65535", ["PORT"]);
  }

  return port;
}

function validateTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ApiConfigurationError("GROUP_TIMEZONE must be a valid IANA timezone", ["GROUP_TIMEZONE"]);
  }

  return timezone;
}

function validateHttpUrl(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiConfigurationError(`${name} must be an absolute HTTP(S) URL`, [name]);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiConfigurationError(`${name} must be an absolute HTTP(S) URL`, [name]);
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.hostname === "") {
    throw new ApiConfigurationError(`${name} must be an absolute HTTP(S) URL`, [name]);
  }

  return value;
}

function validateWebOrigin(value: string): string {
  const validated = validateHttpUrl("WEB_ORIGIN", value);
  let parsed: URL;
  try {
    parsed = new URL(validated);
  } catch {
    throw new ApiConfigurationError("WEB_ORIGIN must be an origin without a path", ["WEB_ORIGIN"]);
  }

  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new ApiConfigurationError("WEB_ORIGIN must be an origin without a path", ["WEB_ORIGIN"]);
  }

  return parsed.origin;
}

function validateMaxAge(value: number | undefined): number {
  const maxAge = value ?? DEFAULT_MINI_APP_INIT_DATA_MAX_AGE_SECONDS;
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
    throw new ApiConfigurationError(
      "Mini App init-data maximum age must be a positive safe integer",
      ["miniAppInitDataMaxAgeSeconds"],
    );
  }

  return maxAge;
}

function parseMaxAge(environment: ApiEnvironment, override: number | undefined): number {
  if (override !== undefined) return validateMaxAge(override);
  const configured = readString(environment, "TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS");
  if (configured === undefined) return validateMaxAge(undefined);
  if (!/^\d+$/u.test(configured)) {
    throw new ApiConfigurationError(
      "TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS must be a positive safe integer",
      ["TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS"],
    );
  }
  return validateMaxAge(Number(configured));
}

export function parseApiConfig(
  environment: ApiEnvironment = process.env,
  options: ApiConfigOptions = {},
): ApiConfig {
  const databaseUrl = requiredString(environment, "DATABASE_URL");
  if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    throw new ApiConfigurationError(
      "DATABASE_URL must use the PostgreSQL postgres:// or postgresql:// scheme",
      ["DATABASE_URL"],
    );
  }

  const telegramWebhookSecret = requiredString(environment, "TELEGRAM_WEBHOOK_SECRET");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(telegramWebhookSecret)) {
    throw new ApiConfigurationError(
      "TELEGRAM_WEBHOOK_SECRET must contain only letters, numbers, underscores, or hyphens",
      ["TELEGRAM_WEBHOOK_SECRET"],
    );
  }

  const logLevel = requiredString(environment, "LOG_LEVEL");
  if (!API_LOG_LEVELS.includes(logLevel as ApiLogLevel)) {
    throw new ApiConfigurationError("LOG_LEVEL must be one of debug, info, warn, or error", ["LOG_LEVEL"]);
  }

  return {
    databaseUrl,
    telegramBotToken: requiredString(environment, "TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret,
    telegramOwnerUserId: requiredInteger(environment, "TELEGRAM_OWNER_USER_ID", "positive"),
    telegramGroupChatId: requiredInteger(environment, "TELEGRAM_CHAT_ID", "nonZero"),
    telegramGeneralTopicId: requiredInteger(environment, "TELEGRAM_GENERAL_TOPIC_ID", "positive"),
    telegramChatTopicId: requiredInteger(environment, "TELEGRAM_CHAT_TOPIC_ID", "positive"),
    telegramMiniAppUrl: validateHttpUrl(
      "TELEGRAM_MINI_APP_URL",
      requiredString(environment, "TELEGRAM_MINI_APP_URL"),
    ),
    webOrigin: validateWebOrigin(requiredString(environment, "WEB_ORIGIN")),
    groupTimezone: validateTimezone(
      readString(environment, "GROUP_TIMEZONE") ?? DEFAULT_GROUP_TIMEZONE,
    ),
    logLevel: logLevel as ApiLogLevel,
    port: parsePort(environment),
    miniAppInitDataMaxAgeSeconds: parseMaxAge(environment, options.miniAppInitDataMaxAgeSeconds),
  };
}

export function validateApiEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
  return { ...parseApiConfig(environment) };
}

export const apiConfiguration = registerAs(API_CONFIG_NAMESPACE, () => parseApiConfig(process.env));
