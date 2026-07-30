import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";

import { ApiConfigModule } from "../config/api-config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { TelegramCallbackService } from "./telegram-callback.service.js";
import { TelegramCardService } from "./telegram-card.service.js";
import { TelegramBotService, TelegramEffects } from "./telegram-effects.js";
import { TelegramWebhookController } from "./telegram-webhook.controller.js";
import { OutboxDispatcher } from "../jobs/outbox.dispatcher.js";
import { OutboxBestEffortService } from "./outbox-best-effort.service.js";
import { TelegramAvatarService } from "./telegram-avatar.service.js";

@Injectable()
class TelegramCallbackRegistration implements OnModuleInit {
  public constructor(
    @Inject(TelegramBotService) private readonly telegramBot: TelegramBotService,
    @Inject(TelegramCallbackService) private readonly callbacks: TelegramCallbackService,
  ) {}

  public onModuleInit(): void {
    this.telegramBot.registerCallbackHandler(async (context) => {
      await this.callbacks.handle(context);
    });
  }
}

@Module({
  imports: [ApiConfigModule, DatabaseModule],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramBotService,
    TelegramEffects,
    TelegramCardService,
    OutboxDispatcher,
    OutboxBestEffortService,
    TelegramAvatarService,
    TelegramCallbackService,
    TelegramCallbackRegistration,
  ],
  exports: [TelegramBotService, TelegramEffects, TelegramCardService, TelegramCallbackService, OutboxDispatcher, OutboxBestEffortService],
})
export class TelegramModule {}
