import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";

import { MiniAppAuthBypass } from "../auth/mini-app-auth.decorator.js";
import { TelegramPollUpdateService } from "./telegram-poll-update.service.js";

@ApiExcludeController()
@MiniAppAuthBypass("telegram-webhook")
@Controller("telegram")
export class TelegramPollController {
  public constructor(@Inject(TelegramPollUpdateService) private readonly updates: TelegramPollUpdateService) {}

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  public webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() body: unknown,
  ): Promise<{ readonly ok: true }> {
    return this.updates.handle(secret, body);
  }
}
