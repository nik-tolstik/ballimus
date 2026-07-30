import { Module, type Type } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { ApiConfigModule } from "./config/api-config.module.js";
import { HealthModule } from "./health/health.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { RestModule } from "./rest/rest.module.js";
import { TelegramModule } from "./telegram/telegram.module.js";

/** Feature modules owned by the API application platform. */
export const API_FEATURE_MODULES: Type<unknown>[] = [RestModule, TelegramModule, JobsModule];

@Module({
  imports: [ApiConfigModule, AuthModule, HealthModule, ...API_FEATURE_MODULES],
})
export class AppModule {}
