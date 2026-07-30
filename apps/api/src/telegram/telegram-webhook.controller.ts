import { timingSafeEqual } from "node:crypto";

import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Update } from "grammy/types";

import { MiniAppAuthBypass } from "../auth/mini-app-auth.decorator.js";
import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { TelegramBotService } from "./telegram-effects.js";

const TELEGRAM_WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validUpdateId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Compares equal-length padded buffers so a wrong-length secret still uses a timing-safe primitive. */
export function timingSafeTelegramSecretEquals(
  candidate: unknown,
  expected: string,
): boolean {
  if (typeof candidate !== "string") return false;
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  const length = Math.max(candidateBytes.length, expectedBytes.length);
  if (length === 0) return false;

  const paddedCandidate = Buffer.alloc(length);
  const paddedExpected = Buffer.alloc(length);
  candidateBytes.copy(paddedCandidate);
  expectedBytes.copy(paddedExpected);
  const equal = timingSafeEqual(paddedCandidate, paddedExpected);
  return equal && candidateBytes.length === expectedBytes.length;
}

/** Validates only the envelope needed before handing an update to grammY. */
export function parseTelegramUpdateBody(value: unknown): Update {
  if (!isRecord(value) || !validUpdateId(value["update_id"])) {
    throw new BadRequestException({
      code: "TELEGRAM_UPDATE_MALFORMED",
      message: "Telegram update is malformed.",
    });
  }

  const callbackQuery = value["callback_query"];
  if (callbackQuery !== undefined && !isRecord(callbackQuery)) {
    throw new BadRequestException({
      code: "TELEGRAM_CALLBACK_MALFORMED",
      message: "Telegram callback query is malformed.",
    });
  }
  return value as unknown as Update;
}

@ApiTags("telegram")
@Controller("telegram")
export class TelegramWebhookController {
  public constructor(
    @Inject(TelegramBotService) private readonly telegramBot: TelegramBotService,
    @Inject(API_CONFIG) private readonly apiConfig: ApiConfig,
  ) {}

  @Post("webhook")
  @HttpCode(HttpStatus.NO_CONTENT)
  @MiniAppAuthBypass("telegram-webhook")
  @ApiExcludeEndpoint()
  @ApiOperation({
    operationId: "receiveTelegramWebhookUpdate",
    summary: "Receive a Telegram callback update",
  })
  public async receiveWebhook(
    @Headers(TELEGRAM_WEBHOOK_SECRET_HEADER) secret: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    if (!timingSafeTelegramSecretEquals(secret, this.apiConfig.telegramWebhookSecret)) {
      throw new UnauthorizedException({
        code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
        message: "Telegram webhook secret is invalid.",
      });
    }

    await this.telegramBot.handleUpdate(parseTelegramUpdateBody(body));
  }
}
