import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { ApiConfigModule } from "../config/api-config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { BootstrapController, MatchesController, PollsController, VenuesController, WeatherController } from "./rest.controller.js";
import { RestService } from "./rest.service.js";
import { CurrentWeatherService } from "../weather/current-weather.service.js";
import { AccessController } from "./access.controller.js";

@Module({
  imports: [ApiConfigModule, AuthModule, DatabaseModule, TelegramModule, JobsModule],
  controllers: [AccessController, BootstrapController, MatchesController, PollsController, WeatherController, VenuesController],
  providers: [RestService, CurrentWeatherService],
  exports: [RestService],
})
export class RestModule {}
