import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { JobsRunner } from "./jobs.runner.js";
import {
  DatabaseWeatherDueMatchProvider,
  DatabaseWeatherNotificationRepository,
  OpenMeteoWeatherForecastProvider,
  WEATHER_JOB_PROVIDERS,
} from "./weather.adapters.js";
import { WeatherRunner } from "./weather.runner.js";

@Module({
  imports: [DatabaseModule, TelegramModule],
  providers: [
    DatabaseWeatherDueMatchProvider,
    DatabaseWeatherNotificationRepository,
    OpenMeteoWeatherForecastProvider,
    ...WEATHER_JOB_PROVIDERS,
    WeatherRunner,
    JobsRunner,
  ],
  exports: [JobsRunner, WeatherRunner],
})
export class JobsModule {}
