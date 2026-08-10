import { Module } from "@nestjs/common";

import { ApiConfigModule } from "../config/api-config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OutboxDispatcher } from "../jobs/outbox.dispatcher.js";
import { OutboxBestEffortService } from "./outbox-best-effort.service.js";
import { TelegramCardService } from "./telegram-card.service.js";
import { TelegramBotService, TelegramEffects } from "./telegram-effects.js";

@Module({
  imports: [ApiConfigModule, DatabaseModule],
  providers: [TelegramBotService, TelegramEffects, TelegramCardService, OutboxDispatcher, OutboxBestEffortService],
  exports: [TelegramEffects, TelegramCardService, OutboxDispatcher, OutboxBestEffortService],
})
export class TelegramModule {}
