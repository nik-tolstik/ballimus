export const TELEGRAM_INIT_DATA_HEADER = "X-Telegram-Init-Data" as const;
export const TELEGRAM_INIT_DATA_HEADER_LOWERCASE = TELEGRAM_INIT_DATA_HEADER.toLowerCase();
export const MINI_APP_AUTH_BYPASS_METADATA = "api:mini-app-auth-bypass" as const;
export const TELEGRAM_WEB_APP_DATA_LABEL = "WebAppData" as const;
export const MINI_APP_REQUEST_USER = "telegramMiniAppUser" as const;

export const MINI_APP_AUTH_BYPASS_SCOPES = ["health", "cron", "telegram-webhook"] as const;
export type MiniAppAuthBypassScope = (typeof MINI_APP_AUTH_BYPASS_SCOPES)[number];

export const MINI_APP_AUTH_FAILURE_CODES = [
  "TELEGRAM_INIT_DATA_REQUIRED",
  "TELEGRAM_INIT_DATA_MALFORMED",
  "TELEGRAM_INIT_DATA_INVALID",
  "TELEGRAM_INIT_DATA_EXPIRED",
  "TELEGRAM_OWNER_REQUIRED",
] as const;
export type MiniAppAuthFailureCode = (typeof MINI_APP_AUTH_FAILURE_CODES)[number];

export const DEFAULT_AUTH_DATE_FUTURE_SKEW_SECONDS = 5 * 60;
