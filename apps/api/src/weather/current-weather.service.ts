import { Inject, Injectable } from "@nestjs/common";
import {
  MINSK_LATITUDE,
  MINSK_LONGITUDE,
  formatCurrentWeatherMessage,
  parseOpenMeteoCurrentWeather,
  type CurrentWeather,
} from "@football/domain";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { TelegramEffects } from "../telegram/telegram-effects.js";

const OPEN_METEO_CURRENT_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

/** Fetches the current Minsk weather and sends it directly to the configured Telegram topic. */
@Injectable()
export class CurrentWeatherService {
  public constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(TelegramEffects) private readonly telegram: TelegramEffects,
  ) {}

  public async sendCurrentWeather(): Promise<CurrentWeather> {
    const url = new URL(OPEN_METEO_CURRENT_WEATHER_URL);
    url.searchParams.set("latitude", String(MINSK_LATITUDE));
    url.searchParams.set("longitude", String(MINSK_LONGITUDE));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m");
    url.searchParams.set("timezone", this.config.groupTimezone);

    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Open-Meteo returned ${String(response.status)}`);
    const weather = parseOpenMeteoCurrentWeather(await response.json());
    await this.telegram.sendMessage({
      chatId: this.config.telegramGroupChatId,
      text: formatCurrentWeatherMessage(weather),
      ...(this.config.telegramChatTopicId === 1n ? {} : { messageThreadId: this.config.telegramChatTopicId }),
    });
    return weather;
  }
}
