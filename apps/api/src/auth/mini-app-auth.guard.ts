import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import {
  DEFAULT_AUTH_DATE_FUTURE_SKEW_SECONDS,
  MINI_APP_AUTH_BYPASS_METADATA,
  MINI_APP_REQUEST_USER,
  TELEGRAM_INIT_DATA_HEADER_LOWERCASE,
  TELEGRAM_WEB_APP_DATA_LABEL,
  type MiniAppAuthBypassScope,
  type MiniAppAuthFailureCode,
} from "./mini-app-auth.constants.js";

export interface MiniAppAuthenticatedUser {
  readonly id: bigint;
}

interface MiniAppRequest {
  headers?: Record<string, unknown>;
  [MINI_APP_REQUEST_USER]?: MiniAppAuthenticatedUser;
}

export interface ValidateTelegramMiniAppInitDataOptions {
  readonly botToken: string;
  readonly ownerUserId: bigint;
  readonly maxAgeSeconds: number;
  readonly nowSeconds?: number;
}

export interface ValidatedTelegramMiniAppInitData {
  readonly user: MiniAppAuthenticatedUser;
  readonly authDate: Date;
}

export class MiniAppAuthValidationError extends Error {
  readonly code: Exclude<MiniAppAuthFailureCode, "TELEGRAM_INIT_DATA_REQUIRED">;

  constructor(
    code: Exclude<MiniAppAuthFailureCode, "TELEGRAM_INIT_DATA_REQUIRED">,
    message: string,
  ) {
    super(message);
    this.name = "MiniAppAuthValidationError";
    this.code = code;
  }
}

function validationError(
  code: Exclude<MiniAppAuthFailureCode, "TELEGRAM_INIT_DATA_REQUIRED">,
): MiniAppAuthValidationError {
  const messages: Record<MiniAppAuthValidationError["code"], string> = {
    TELEGRAM_INIT_DATA_MALFORMED: "Telegram Mini App init data is malformed.",
    TELEGRAM_INIT_DATA_INVALID: "Telegram Mini App init data is invalid.",
    TELEGRAM_INIT_DATA_EXPIRED: "Telegram Mini App init data has expired; reopen the Mini App.",
    TELEGRAM_OWNER_REQUIRED: "This Telegram Mini App is restricted to the configured owner.",
  };
  return new MiniAppAuthValidationError(code, messages[code]);
}

function parseUserId(value: unknown): bigint | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      const parsed = BigInt(value);
      return parsed > 0n ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return undefined;
  return BigInt(value);
}

function parseAuthDate(value: string): bigint | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function readSingleParameter(parameters: URLSearchParams, name: string): string | undefined {
  const values = parameters.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function calculateHash(dataCheckString: string, botToken: string): Buffer {
  const secretKey = createHmac("sha256", TELEGRAM_WEB_APP_DATA_LABEL)
    .update(botToken, "utf8")
    .digest();
  return createHmac("sha256", secretKey).update(dataCheckString, "utf8").digest();
}

function isHashValid(providedHash: string | undefined, calculatedHash: Buffer): boolean {
  if (providedHash === undefined || !/^[0-9a-f]{64}$/i.test(providedHash)) return false;
  const provided = Buffer.from(providedHash, "hex");
  return provided.length === calculatedHash.length && timingSafeEqual(provided, calculatedHash);
}

function parseAndValidateUser(userValue: string | undefined): MiniAppAuthenticatedUser {
  if (userValue === undefined) throw validationError("TELEGRAM_INIT_DATA_MALFORMED");

  let parsed: unknown;
  try {
    parsed = JSON.parse(userValue) as unknown;
  } catch {
    throw validationError("TELEGRAM_INIT_DATA_MALFORMED");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationError("TELEGRAM_INIT_DATA_MALFORMED");
  }

  const userId = parseUserId((parsed as { id?: unknown }).id);
  if (userId === undefined) throw validationError("TELEGRAM_INIT_DATA_MALFORMED");
  return { id: userId };
}

export function validateTelegramMiniAppInitData(
  rawInitData: string,
  options: ValidateTelegramMiniAppInitDataOptions,
): ValidatedTelegramMiniAppInitData {
  if (rawInitData.trim() === "") throw validationError("TELEGRAM_INIT_DATA_MALFORMED");

  let parameters: URLSearchParams;
  try {
    parameters = new URLSearchParams(rawInitData);
  } catch {
    throw validationError("TELEGRAM_INIT_DATA_MALFORMED");
  }

  const entries = Array.from(parameters.entries());
  const uniqueNames = new Set(entries.map(([name]) => name));
  if (uniqueNames.size !== entries.length) throw validationError("TELEGRAM_INIT_DATA_MALFORMED");

  const providedHash = readSingleParameter(parameters, "hash");
  const authDateValue = readSingleParameter(parameters, "auth_date");
  const userValue = readSingleParameter(parameters, "user");
  if (providedHash === undefined || authDateValue === undefined || userValue === undefined) {
    throw validationError("TELEGRAM_INIT_DATA_MALFORMED");
  }

  const dataCheckString = entries
    .filter(([name]) => name !== "hash")
    .sort(([leftName], [rightName]) => (leftName < rightName ? -1 : leftName > rightName ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  if (!isHashValid(providedHash, calculateHash(dataCheckString, options.botToken))) {
    throw validationError("TELEGRAM_INIT_DATA_INVALID");
  }

  const authDate = parseAuthDate(authDateValue);
  const nowSeconds = BigInt(Math.floor(options.nowSeconds ?? Date.now() / 1000));
  if (authDate === undefined || authDate > nowSeconds + BigInt(DEFAULT_AUTH_DATE_FUTURE_SKEW_SECONDS)) {
    throw validationError("TELEGRAM_INIT_DATA_INVALID");
  }
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw validationError("TELEGRAM_INIT_DATA_INVALID");
  }
  if (nowSeconds - authDate > BigInt(options.maxAgeSeconds)) {
    throw validationError("TELEGRAM_INIT_DATA_EXPIRED");
  }

  const user = parseAndValidateUser(userValue);
  if (user.id !== options.ownerUserId) throw validationError("TELEGRAM_OWNER_REQUIRED");

  return {
    user,
    authDate: new Date(Number(authDate) * 1000),
  };
}

function headerValue(request: MiniAppRequest): string | undefined {
  const headers = request.headers;
  if (headers === undefined) return undefined;

  const value = headers[TELEGRAM_INIT_DATA_HEADER_LOWERCASE] ?? headers["X-Telegram-Init-Data"];
  if (typeof value === "string") return value;
  return undefined;
}

function authException(error: MiniAppAuthValidationError): UnauthorizedException | ForbiddenException {
  const response = { code: error.code, message: error.message };
  return error.code === "TELEGRAM_OWNER_REQUIRED"
    ? new ForbiddenException(response)
    : new UnauthorizedException(response);
}

@Injectable()
export class MiniAppAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(API_CONFIG) private readonly apiConfig: ApiConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const bypass = this.reflector.getAllAndOverride<MiniAppAuthBypassScope | undefined>(
      MINI_APP_AUTH_BYPASS_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (bypass !== undefined) return true;
    if (context.getType<string>() !== "http") {
      throw new UnauthorizedException({
        code: "TELEGRAM_INIT_DATA_REQUIRED",
        message: "Telegram Mini App authentication is required.",
      });
    }

    const request = context.switchToHttp().getRequest<MiniAppRequest>();
    const rawInitData = headerValue(request);
    if (rawInitData === undefined) {
      throw new UnauthorizedException({
        code: "TELEGRAM_INIT_DATA_REQUIRED",
        message: "Telegram Mini App authentication is required.",
      });
    }

    try {
      const validated = validateTelegramMiniAppInitData(rawInitData, {
        botToken: this.apiConfig.telegramBotToken,
        ownerUserId: this.apiConfig.telegramOwnerUserId,
        maxAgeSeconds: this.apiConfig.miniAppInitDataMaxAgeSeconds,
      });
      request[MINI_APP_REQUEST_USER] = validated.user;
      return true;
    } catch (error) {
      if (error instanceof MiniAppAuthValidationError) throw authException(error);
      throw new UnauthorizedException({
        code: "TELEGRAM_INIT_DATA_INVALID",
        message: "Telegram Mini App init data is invalid.",
      });
    }
  }
}
