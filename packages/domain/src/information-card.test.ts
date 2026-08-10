import { describe, expect, it } from "vitest";

import { renderInformationMatchCard } from "./match-card.js";
import { formatCurrentWeatherMessage, parseOpenMeteoCurrentWeather } from "./weather.js";

describe("information card domain", () => {
  it("renders static match information without participant or voting controls", () => {
    const card = renderInformationMatchCard({
      match: {
        id: 1n,
        chatId: -100n,
        scheduledAt: new Date("2026-08-10T17:00:00.000Z"),
        durationMinutes: 90,
        venueId: 2n,
        fieldPriceRubles: 120,
        creatorTelegramUserId: 3n,
        deletionRequestedAt: null,
      },
      venue: { id: 2n, name: "BOX365 <main>", mapUrl: "https://maps.example.test/field?a=1&b=2", venueType: "indoor" },
    });

    expect(card).toContain("Понедельник, 10 августа · 20:00-21:30");
    expect(card).not.toMatch(/\d+ ч|\d+ мин/u);
    expect(card).toContain("Точка на карте");
    expect(card).toContain("В здании");
    expect(card).toContain("120 рублей");
    expect(card).not.toMatch(/голос|игрок|состав|callback/iu);
    expect(card).not.toContain("⚽ Футбол");
    expect(card).not.toContain("<main>");
  });

  it("formats Open-Meteo current weather for Minsk", () => {
    const weather = parseOpenMeteoCurrentWeather({
      current: {
        time: "2026-08-10T14:00",
        temperature_2m: 21.2,
        apparent_temperature: 20.7,
        precipitation: 0,
        weather_code: 1,
        wind_speed_10m: 3.5,
        wind_gusts_10m: 5.1,
      },
    });

    const message = formatCurrentWeatherMessage(weather)

    expect(message).toContain("Погода сейчас в Минске")
    expect(message).not.toContain("Обновлено:")
    expect(message).not.toContain(weather.observedAt)
    expect(weather.temperatureCelsius).toBe(21.2)
  });
});
