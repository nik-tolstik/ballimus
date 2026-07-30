import { Module } from "@nestjs/common";

import { ApiConfigModule } from "../config/api-config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { BootstrapController, MatchesController } from "./rest.controller.js";
import { PlayersController } from "./players.controller.js";
import { OwnerRestService } from "./rest.service.js";

@Module({
  imports: [ApiConfigModule, DatabaseModule, TelegramModule],
  controllers: [BootstrapController, MatchesController, PlayersController],
  providers: [OwnerRestService],
  exports: [OwnerRestService],
})
export class RestModule {}
