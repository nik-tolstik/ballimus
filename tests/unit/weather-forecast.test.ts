import { describe, expect, it } from "vitest";

import {
  OpenMeteoWeatherForecastClient,
  WeatherForecastError,
  formatWeatherForecastNotification,
  weatherDescription,
  weatherForecastTransitionKey,
} from "../../src/application/weather-forecast.js";

const scheduledAt = new Date("2026-08-02T17:00:00.000Z");

function openMeteoResponse() {
  return {
    hourly: {
      time: ["2026-08-02T19:00", "2026-08-02T20:00", "2026-08-02T21:00"],
      temperature_2m: [19.2, 18.5, 17.7],
      apparent_temperature: [18.4, 17.1, 16.2],
      precipitation_probability: [5, 40, 65],
      precipitation: [0, 0.4, 1.2],
      weather_code: [2, 61, 80],
      wind_speed_10m: [3.2, 4.5, 5.8],
      wind_gusts_10m: [5.1, 7.2, 9.8],
    },
  };
}

describe("Open-Meteo weather forecasts", () => {
  it("requests the Minsk forecast for the match hour and parses it", async () => {
    let requestedUrl: URL | undefined;
    const client = new OpenMeteoWeatherForecastClient(async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        status: 200,
        json: async () => openMeteoResponse(),
      };
    });

    await expect(client.forecastAt(scheduledAt)).resolves.toEqual({
      forecastTime: "2026-08-02T20:00",
      temperatureCelsius: 18.5,
      apparentTemperatureCelsius: 17.1,
      precipitationProbability: 40,
      precipitationMillimetres: 0.4,
      weatherCode: 61,
      windSpeedMetresPerSecond: 4.5,
      windGustsMetresPerSecond: 7.2,
    });

    expect(requestedUrl?.origin).toBe("https://api.open-meteo.com");
    expect(requestedUrl?.pathname).toBe("/v1/forecast");
    expect(requestedUrl?.searchParams.get("latitude")).toBe("53.9006");
    expect(requestedUrl?.searchParams.get("longitude")).toBe("27.559");
    expect(requestedUrl?.searchParams.get("timezone")).toBe("Europe/Minsk");
    expect(requestedUrl?.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(requestedUrl?.searchParams.get("start_date")).toBe("2026-08-02");
    expect(requestedUrl?.searchParams.get("end_date")).toBe("2026-08-02");
    expect(requestedUrl?.searchParams.get("hourly")).toContain("weather_code");
  });

  it("rejects a malformed response instead of sending an invented forecast", async () => {
    const client = new OpenMeteoWeatherForecastClient(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hourly: { time: ["2026-08-02T20:00"] } }),
    }));

    await expect(client.forecastAt(scheduledAt)).rejects.toBeInstanceOf(WeatherForecastError);
  });

  it("formats the requested multi-line Minsk weather notification", () => {
    expect(formatWeatherForecastNotification(
      {
        forecastTime: "2026-08-02T20:00",
        temperatureCelsius: 18.5,
        apparentTemperatureCelsius: 16,
        precipitationProbability: 31,
        precipitationMillimetres: 0,
        weatherCode: 3,
        windSpeedMetresPerSecond: 5,
        windGustsMetresPerSecond: 10.6,
      },
      scheduledAt,
      new Date("2026-08-02T01:00:00.000Z"),
    )).toBe(
      "<b>Прогноз погоды на сегодня в Минске</b>\n" +
        "🌡 18,5 °C, ощущается как 16 °C, пасмурно.\n" +
        "🌧 Осадки: 31% (0 мм)\n" +
        "🍃 Ветер: 5 м/с\n" +
        "🌪 Порывы: 10,6 м/с",
    );
  });

  it("labels a next-day forecast as tomorrow in Minsk", () => {
    const text = formatWeatherForecastNotification(
      {
        forecastTime: "2026-08-02T20:00",
        temperatureCelsius: 18.5,
        apparentTemperatureCelsius: 17.1,
        precipitationProbability: 40,
        precipitationMillimetres: 0.4,
        weatherCode: 61,
        windSpeedMetresPerSecond: 4.5,
        windGustsMetresPerSecond: 7.2,
      },
      scheduledAt,
      new Date("2026-08-01T17:00:00.000Z"),
    );

    expect(text.startsWith("<b>Прогноз погоды на завтра в Минске</b>")).toBe(true);
  });

  it("maps public WMO weather conditions and has a stable dedupe key", () => {
    expect(weatherDescription(0)).toBe("ясно");
    expect(weatherDescription(99)).toBe("гроза с градом");
    expect(weatherDescription(999)).toBe("неизвестные погодные условия");
    expect(weatherForecastTransitionKey(-100123, scheduledAt)).toBe("forecast:-100123:2026-08-02");
    expect(
      weatherForecastTransitionKey(-100123, new Date("2026-08-02T18:00:00.000Z")),
    ).toBe("forecast:-100123:2026-08-02");
    expect(
      weatherForecastTransitionKey(-100123, new Date("2026-08-02T21:30:00.000Z")),
    ).toBe("forecast:-100123:2026-08-03");
  });
});
