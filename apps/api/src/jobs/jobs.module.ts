import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { JobsRunner } from "./jobs.runner.js";

@Module({
  imports: [DatabaseModule, TelegramModule],
  providers: [JobsRunner],
  exports: [JobsRunner],
})
export class JobsModule {}
