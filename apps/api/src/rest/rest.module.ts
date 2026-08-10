import { Module } from "@nestjs/common";

import { ApiConfigModule } from "../config/api-config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { BootstrapController, MatchesController, PollsController, VenuesController, WeatherController } from "./rest.controller.js";
import { OwnerRestService } from "./rest.service.js";
import { CurrentWeatherService } from "../weather/current-weather.service.js";

@Module({
  imports: [ApiConfigModule, DatabaseModule, TelegramModule, JobsModule],
  controllers: [BootstrapController, MatchesController, PollsController, WeatherController, VenuesController],
  providers: [OwnerRestService, CurrentWeatherService],
  exports: [OwnerRestService],
})
export class RestModule {}
