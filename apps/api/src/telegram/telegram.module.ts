import { Module } from "@nestjs/common";

import { ApiConfigModule } from "../config/api-config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OutboxDispatcher } from "../jobs/outbox.dispatcher.js";
import { OutboxBestEffortService } from "./outbox-best-effort.service.js";
import { TelegramCardService } from "./telegram-card.service.js";
import { TelegramBotService, TelegramEffects } from "./telegram-effects.js";
import { TelegramPollController } from "./telegram-poll.controller.js";
import { TelegramPollPublicationService } from "./telegram-poll-publication.service.js";
import { TelegramPollUpdateService } from "./telegram-poll-update.service.js";
import { TelegramGroupMembersService } from "./telegram-group-members.service.js";

@Module({
  imports: [ApiConfigModule, DatabaseModule],
  controllers: [TelegramPollController],
  providers: [TelegramBotService, TelegramEffects, TelegramCardService, TelegramPollPublicationService, TelegramPollUpdateService, OutboxDispatcher, OutboxBestEffortService, TelegramGroupMembersService],
  exports: [TelegramBotService, TelegramEffects, TelegramCardService, TelegramPollPublicationService, TelegramPollUpdateService, OutboxDispatcher, OutboxBestEffortService, TelegramGroupMembersService],
})
export class TelegramModule {}
