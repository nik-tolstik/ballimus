import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  LifecycleConflictError,
  MINSK_TIMEZONE,
  WEATHER_FORECAST_LEAD_TIME_MS,
  assertValidCreateMatchInput,
  calculateRosterCounts,
  cumulativeAvailabilityCount,
  deriveMatchPlanningStage,
  calendarDateInTimeZone,
  canTransitionMatch,
  countExternalParticipantQuantity,
  evaluateExternalParticipantChange,
  evaluateThresholdTransition,
  evaluateVoteTransition,
  escapeHtml,
  eligibleWeatherForecastMatches,
  formatCancellationNotification,
  formatConfirmationNotification,
  formatMatchCardTitle,
  formatWeatherForecastNotification,
  isEditableMatchStatus,
  isVoteEligibleForMatch,
  isWeatherForecastEligible,
  parseLocalDateTime,
  parseOpenMeteoForecast,
  renderMatchCard,
  selectedTimeForFinalTime,
  thresholdLostNotificationTransition,
  thresholdReachedNotificationTransition,
  transitionMatch,
  type ExternalParticipant,
  type Match,
  type Vote,
  weatherForecastTransitionKey,
} from "./index.js";

const baseMatch: Match = {
  id: 32,
  chatId: -100,
  scheduledAt: new Date("2026-07-27T17:00:00.000Z"),
  location: "BOX365 <main>",
  venueType: "outdoor",
  fieldPriceRubles: 100,
  title: "27.07.2026 20:00 (BOX365 <main>, 100 рублей)",
  requiredPlayers: 3,
  status: "active",
  cancellationReason: null,
  creatorTelegramUserId: 7,
};

function vote(
  telegramUserId: number,
  option: Vote["option"],
  displayNameSnapshot = `Player ${telegramUserId}`,
): Vote {
  return {
    matchId: baseMatch.id,
    telegramUserId,
    usernameSnapshot: null,
    displayNameSnapshot,
    option,
  };
}

function external(
  id: number,
  quantity: number,
  sourceLabel: string | null,
  displayNameSnapshot: string | null = null,
): ExternalParticipant {
  return {
    id,
    matchId: baseMatch.id,
    addedByTelegramUserId: 7,
    sourceUpdateId: id,
    sourceLabel,
    displayNameSnapshot,
    quantity,
  };
}

describe("public domain entrypoint and validation", () => {
  it("rejects malformed creation input and accepts normalized match input", () => {
    const malformed = {
      date: "2026-02-30",
      time: "25:61",
      location: "X",
      venueType: "garage",
      requiredPlayers: 0,
      unexpected: true,
    };
    expect(() => assertValidCreateMatchInput(malformed)).toThrow(DomainValidationError);

    expect(assertValidCreateMatchInput({
      date: "2026-08-03",
      time: "20:00",
      timeMode: "exact",
      timeOptions: [],
      location: "  Ракета  ",
      venueType: "outdoor",
      requiredPlayers: 10,
      fieldPriceRubles: null,
    })).toEqual({
      date: "2026-08-03",
      time: "20:00",
      timeMode: "exact",
      timeOptions: [],
      location: "Ракета",
      venueType: "outdoor",
      requiredPlayers: 10,
      fieldPriceRubles: null,
    });
  });

  it("normalizes availability choices and calculates cumulative attendance", () => {
    const singleOption = assertValidCreateMatchInput({
      date: "2026-08-03",
      time: null,
      timeMode: "availability",
      timeOptions: ["19:00"],
      location: "Ракета",
      venueType: "outdoor",
      requiredPlayers: 3,
    });
    expect(singleOption.timeOptions).toEqual(["19:00"]);

    const matchInput = assertValidCreateMatchInput({
      date: "2026-08-03",
      time: null,
      timeMode: "availability",
      timeOptions: ["20:00", "19:00"],
      location: "Ракета",
      venueType: "outdoor",
      requiredPlayers: 3,
    });
    expect(matchInput.timeOptions).toEqual(["19:00", "20:00"]);

    const exactOptions = assertValidCreateMatchInput({
      date: "2026-08-03",
      time: null,
      timeMode: "exact_options",
      timeOptions: ["20:00", "19:00"],
      location: "Ракета",
      venueType: "outdoor",
      requiredPlayers: 3,
    });
    expect(exactOptions.timeOptions).toEqual(["19:00", "20:00"]);

    const availabilityVotes: Vote[] = [
      { ...vote(1, "going"), availableAfter: "19:00" },
      { ...vote(2, "going"), availableAfter: "20:00" },
      vote(3, "maybe"),
    ];
    expect(cumulativeAvailabilityCount(availabilityVotes, "19:00", 1)).toBe(2);
    expect(cumulativeAvailabilityCount(availabilityVotes, "20:00", 1)).toBe(3);
    expect(isVoteEligibleForMatch({ timeMode: "availability", selectedTime: "19:00" }, availabilityVotes[0] as Vote)).toBe(true);
    expect(isVoteEligibleForMatch({ timeMode: "availability", selectedTime: "19:00" }, availabilityVotes[1] as Vote)).toBe(false);
    const multipleExactTimesVote = { ...vote(4, "going"), exactTimes: ["19:00", "20:00"] };
    expect(isVoteEligibleForMatch({ timeMode: "exact_options", selectedTime: "20:00" }, availabilityVotes[0] as Vote)).toBe(false);
    expect(isVoteEligibleForMatch({ timeMode: "exact_options", selectedTime: "20:00" }, availabilityVotes[1] as Vote)).toBe(true);
    expect(isVoteEligibleForMatch({ timeMode: "exact_options", selectedTime: "19:00" }, multipleExactTimesVote)).toBe(true);
    expect(isVoteEligibleForMatch({ timeMode: "exact_options", selectedTime: "20:00" }, multipleExactTimesVote)).toBe(true);
    expect(selectedTimeForFinalTime("exact_options", ["19:00", "20:00"], "20:00")).toBe("20:00");
    expect(selectedTimeForFinalTime("exact_options", ["19:00", "20:00"], "20:30")).toBeUndefined();
    expect(selectedTimeForFinalTime("availability", ["19:00", "20:00"], "20:30")).toBe("20:00");
  });
});

describe("match lifecycle", () => {
  it("allows only the planned lifecycle and keeps active/confirmed changes editable", () => {
    expect(canTransitionMatch("draft", "active")).toBe(true);
    expect(canTransitionMatch("active", "confirmed")).toBe(true);
    expect(canTransitionMatch("confirmed", "completed")).toBe(true);
    expect(canTransitionMatch("active", "cancelled")).toBe(true);
    expect(canTransitionMatch("confirmed", "cancelled")).toBe(true);
    expect(canTransitionMatch("draft", "confirmed")).toBe(false);
    expect(canTransitionMatch("active", "completed")).toBe(false);

    const draft = { ...baseMatch, status: "draft" as const };
    const active = transitionMatch(draft, "active");
    const confirmed = transitionMatch(active, "confirmed");
    const completed = transitionMatch(confirmed, "completed");
    const cancelled = transitionMatch(confirmed, "cancelled", { cancellationReason: "Плохая погода" });
    expect(active.status).toBe("active");
    expect(confirmed.status).toBe("confirmed");
    expect(completed.status).toBe("completed");
    expect(completed.cancellationReason).toBeNull();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toBe("Плохая погода");
    expect(isEditableMatchStatus(active.status)).toBe(true);
    expect(isEditableMatchStatus(confirmed.status)).toBe(true);
    expect(isEditableMatchStatus(completed.status)).toBe(false);
    expect(draft.status).toBe("draft");
  });

  it("reports lifecycle conflicts and requires a bounded cancellation reason", () => {
    expect(() => transitionMatch(baseMatch, "completed")).toThrow(LifecycleConflictError);
    expect(() => transitionMatch(baseMatch, "cancelled")).toThrow("cancellationReason is required");
    expect(() => transitionMatch(baseMatch, "cancelled", { cancellationReason: "Плохая погода" })).not.toThrow();
    expect(() => transitionMatch({ ...baseMatch, status: "cancelled", cancellationReason: "Причина" }, "active")).toThrow(LifecycleConflictError);
  });
});

describe("match planning stages", () => {
  it("derives the next owner task from time, roster, and venue readiness", () => {
    expect(deriveMatchPlanningStage({
      ...baseMatch,
      scheduledAt: null,
      timeMode: "availability",
      selectedTime: null,
      location: null,
    }, 2)).toBe("recruiting_players");

    expect(deriveMatchPlanningStage({
      ...baseMatch,
      scheduledAt: null,
      timeMode: "availability",
      selectedTime: null,
      location: null,
    }, 3)).toBe("finalizing_details");

    expect(deriveMatchPlanningStage({ ...baseMatch, location: "BOX365" }, 2))
      .toBe("recruiting_players");
    expect(deriveMatchPlanningStage({ ...baseMatch, location: null }, 3))
      .toBe("finalizing_details");
    expect(deriveMatchPlanningStage(baseMatch, 3)).toBe("ready_to_confirm");
    expect(deriveMatchPlanningStage({ ...baseMatch, status: "confirmed" }, 3)).toBeNull();
  });
});

describe("roster and threshold rules", () => {
  it("counts external quantities toward a threshold without imposing capacity", () => {
    const participants = [external(1, 3, "Никиты"), external(2, -1, "Никиты"), external(3, 1, null, "Ваня")];
    expect(countExternalParticipantQuantity(participants)).toBe(3);
    expect(calculateRosterCounts({
      requiredPlayers: 3,
      votes: [vote(1, "going")],
      externalParticipants: participants,
    })).toEqual({
      goingVotes: 1,
      externalParticipants: 3,
      goingCount: 4,
      requiredPlayers: 3,
      thresholdReached: true,
      remainingToThreshold: 0,
    });
  });

  it("detects upward, downward, and repeated threshold crossings", () => {
    expect(evaluateThresholdTransition({ countBefore: 2, countAfter: 3, threshold: 3, eventKey: "42" })).toEqual({
      thresholdReached: true,
      thresholdLost: false,
      thresholdReachedNotificationKey: "threshold:reached:42",
    });
    expect(evaluateThresholdTransition({ countBefore: 3, countAfter: 2, threshold: 3, eventKey: "43" })).toEqual({
      thresholdReached: false,
      thresholdLost: true,
      thresholdLostNotificationKey: "threshold:lost:43",
    });
    expect(evaluateThresholdTransition({ countBefore: 4, countAfter: 5, threshold: 3, eventKey: "44" })).toMatchObject({
      thresholdReached: false,
      thresholdLost: false,
    });
    expect(evaluateVoteTransition({
      previousOption: "going",
      nextOption: "maybe",
      goingCountBefore: 3,
      threshold: 3,
      eventKey: "45",
    })).toMatchObject({ goingCountAfter: 2, thresholdLost: true });
  });

  it("handles owner quantity changes and rejects an over-removal", () => {
    expect(evaluateExternalParticipantChange({
      externalCountBefore: 1,
      sourceCountBefore: 1,
      goingVotes: 1,
      quantity: 2,
      threshold: 4,
      eventKey: "add-1",
      matchStatus: "confirmed",
    })).toMatchObject({
      externalCountAfter: 3,
      goingCountBefore: 2,
      goingCountAfter: 4,
      thresholdReached: true,
    });
    expect(() => evaluateExternalParticipantChange({
      externalCountBefore: 1,
      sourceCountBefore: 1,
      goingVotes: 0,
      quantity: -2,
      threshold: 3,
      eventKey: "remove-1",
    })).toThrow("source contains");
  });
});

describe("HTML-safe card formatting", () => {
  it("escapes fields, groups external quantities, and strips legacy title details", () => {
    expect(escapeHtml(`<&>"`)).toBe("&lt;&amp;&gt;&quot;");
    const card = renderMatchCard({
      match: baseMatch,
      votes: [vote(1, "going", "Иван <важный>"), vote(2, "maybe", "Пётр & Саша")],
      externalParticipants: [external(1, 3, "от Никиты"), external(2, -1, "от Никиты"), external(3, 1, null, "Ваня")],
    });
    expect(card.text).toContain("27.07.2026 20:00");
    expect(card.text).not.toContain("BOX365 &lt;main&gt;, 100 рублей)");
    expect(card.text).toContain("Иван &lt;важный&gt;");
    expect(card.text).toContain("Пётр &amp; Саша");
    expect(card.text).toContain("Внешние игроки: 3");
    expect(card.text).toContain("Статус: Готов к подтверждению");
    expect(card.text).toContain("От Никиты: 2");
    expect(card.text).not.toContain("От От Никиты");
    expect(card.text).toContain("От Ваня: 1");
    expect(card.text).not.toContain("Не смогут (0)");
    expect(card.isActive).toBe(true);
  });

  it("stays within Telegram's 4096-character budget with valid tag pairs", () => {
    const votes = Array.from({ length: 300 }, (_, index) => vote(index + 1, "going", `<Player & ${index}>`));
    const card = renderMatchCard({ match: baseMatch, votes });
    expect(card.text.length).toBeLessThanOrEqual(4096);
    expect(card.text).toContain("ещё");
    expect(card.text.match(/<b>/gu)?.length).toBe(card.text.match(/<\/b>/gu)?.length);
    expect(card.text.match(/<i>/gu)?.length).toBe(card.text.match(/<\/i>/gu)?.length);
    expect(card.text).not.toContain("<Player");
  });

  it("shows the exact required player count without a cumulative availability summary", () => {
    const card = renderMatchCard({
      match: {
        ...baseMatch,
        requiredPlayers: 10,
        scheduledAt: null,
        scheduleDate: "2026-08-01",
        timeMode: "availability",
        timeOptions: ["19:00", "20:00"],
        selectedTime: null,
      },
      votes: [{ ...vote(1, "going", "Никита"), availableAfter: "19:00" }],
    });

    expect(card.text).toContain("🏠 Формат: на улице, 10 человек");
    expect(card.text).not.toContain("Доступны к времени:");
    expect(card.text).not.toContain("К 19:00 —");
    expect(card.text).not.toContain("К 20:00 —");
    expect(card.text).toContain("<b>После 19:00 (1)</b>");
    expect(card.text).toContain("<b>После 20:00 (0)</b>");
  });

  it("renders several exact time options without after-time labels", () => {
    const card = renderMatchCard({
      match: {
        ...baseMatch,
        requiredPlayers: 2,
        scheduledAt: null,
        scheduleDate: "2026-08-01",
        timeMode: "exact_options",
        timeOptions: ["19:00", "20:00"],
        selectedTime: null,
      },
      votes: [
        { ...vote(1, "going", "Никита"), exactTimes: ["19:00", "20:00"] },
        { ...vote(2, "going", "Максим"), exactTimes: ["20:00"] },
      ],
    });

    expect(card.text).not.toContain("🕒 Время: выбираем из вариантов");
    expect(card.text).toContain("<b>19:00 (1)</b>");
    expect(card.text).toContain("<b>20:00 (2)</b>");
    expect(card.text.match(/Nikita|Никита/gu)).toHaveLength(2);
    expect(card.text).not.toContain("После 19:00");
    expect(card.text).not.toContain("Не смогут (0)");
    expect(card.text).toContain("<b>👯 Состав 2/2</b>");
  });

  it("shows the booked exact time and separates players who cannot make it", () => {
    const card = renderMatchCard({
      match: {
        ...baseMatch,
        scheduledAt: new Date("2026-08-03T17:30:00.000Z"),
        scheduleDate: "2026-08-03",
        timeMode: "availability",
        timeOptions: ["19:00", "20:00"],
        selectedTime: "19:00",
        status: "confirmed",
      },
      votes: [
        { ...vote(1, "going", "Никита"), availableAfter: "19:00" },
        { ...vote(2, "going", "Максим"), availableAfter: "20:00" },
      ],
    });

    expect(card.text).toContain("🕒 Время: 20:30");
    expect(card.text).not.toContain("Доступны к времени:");
    expect(card.text).toContain("<b>Участвуют (1)</b>");
    expect(card.text).toContain("Не смогут к выбранному времени (1)");
  });
});

describe("Minsk time and weather rules", () => {
  const scheduledAt = new Date("2026-08-02T17:00:00.000Z");
  const forecast = {
    forecastTime: "2026-08-02T20:00",
    temperatureCelsius: 18.5,
    apparentTemperatureCelsius: 16,
    precipitationProbability: 31,
    precipitationMillimetres: 0,
    weatherCode: 3,
    windSpeedMetresPerSecond: 5,
    windGustsMetresPerSecond: 10.6,
  } as const;

  it("formats calendar boundaries in Europe/Minsk and parses local form values", () => {
    expect(calendarDateInTimeZone(new Date("2026-07-27T21:30:00.000Z"), MINSK_TIMEZONE)).toBe("2026-07-28");
    expect(formatMatchCardTitle({ ...baseMatch, scheduledAt: new Date("2026-07-27T21:30:00.000Z") }, {
      timezone: MINSK_TIMEZONE,
      now: new Date("2026-07-27T21:15:00.000Z"),
    })).toBe("Сегодня 00:30");
    expect(parseLocalDateTime("2026-08-03", "20:00").toISOString()).toBe("2026-08-03T17:00:00.000Z");
    expect(() => parseLocalDateTime("2026-02-30", "20:00")).toThrow();
  });

  it("allows only future outdoor active/confirmed matches in the 16-hour window", () => {
    const now = new Date(scheduledAt.getTime() - WEATHER_FORECAST_LEAD_TIME_MS);
    expect(isWeatherForecastEligible({ match: { ...baseMatch, scheduledAt }, now })).toBe(true);
    expect(isWeatherForecastEligible({ match: { ...baseMatch, venueType: "indoor", scheduledAt }, now })).toBe(false);
    expect(isWeatherForecastEligible({ match: { ...baseMatch, status: "draft", scheduledAt }, now })).toBe(false);
    expect(isWeatherForecastEligible({ match: { ...baseMatch, scheduledAt }, now: new Date(scheduledAt.getTime() + 1) })).toBe(false);
    expect(eligibleWeatherForecastMatches([
      { ...baseMatch, id: 1, scheduledAt },
      { ...baseMatch, id: 2, scheduledAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000) },
    ], now)).toHaveLength(1);
  });

  it("parses and formats a forecast, while rejecting malformed provider data", () => {
    const payload = {
      hourly: {
        time: ["2026-08-02T20:00"],
        temperature_2m: [18.5],
        apparent_temperature: [16],
        precipitation_probability: [31],
        precipitation: [0],
        weather_code: [3],
        wind_speed_10m: [5],
        wind_gusts_10m: [10.6],
      },
    };
    expect(parseOpenMeteoForecast(payload, scheduledAt)).toEqual(forecast);
    expect(() => parseOpenMeteoForecast({ hourly: { time: ["2026-08-02T20:00"] } }, scheduledAt)).toThrow();
    expect(formatWeatherForecastNotification(forecast, scheduledAt, new Date("2026-08-02T01:00:00.000Z"))).toBe(
      "<b>Прогноз погоды на сегодня в Минске</b>\n" +
      "🌡 18,5 °C, ощущается как 16 °C, пасмурно.\n" +
      "🌧 Осадки: 31% (0 мм)\n" +
      "🍃 Ветер: 5 м/с\n" +
      "🌪 Порывы: 10,6 м/с",
    );
  });

  it("uses one stable Minsk calendar-day transition key and typed notification transitions", () => {
    const first = thresholdReachedNotificationTransition({
      matchId: 9,
      title: "02.08.2026 время выбираем — BOX365",
      scheduleDate: "2026-08-02",
      location: "BOX365",
      goingCount: 1,
      threshold: 1,
      eventKey: "1",
      requiresExactTime: true,
    });
    const lost = thresholdLostNotificationTransition({
      matchId: -100,
      title: "02.08.2026 20:00 (BOX365, 200 рублей)",
      scheduleDate: "2026-08-02",
      location: "BOX365",
      goingCount: 2,
      threshold: 3,
      cancelledByUsername: "@ivan",
      cancelledByName: "Иван & <Пётр>",
      eventKey: "2",
    });
    expect(first).toMatchObject({ notificationType: "threshold_reached", transitionKey: "threshold:reached:1" });
    expect(first.text).toBe(
      "⚽ <b>Минимальный состав собран!</b>\n" +
      "<b>#v9 · 02.08.2026 · BOX365</b>\n" +
      "👥 Игроков: <b>1 из 1</b>\n\n" +
      "Нужно указать точное время проведения матча.",
    );
    expect(thresholdReachedNotificationTransition({
      matchId: 10,
      goingCount: 1,
      threshold: 1,
      eventKey: "location-only",
      requiresLocation: true,
    }).text).toContain("Нужно указать место проведения матча.");
    expect(thresholdReachedNotificationTransition({
      matchId: 11,
      goingCount: 1,
      threshold: 1,
      eventKey: "time-and-location",
      requiresExactTime: true,
      requiresLocation: true,
    }).text).toContain("Нужно указать точное время и место проведения матча.");
    expect(thresholdReachedNotificationTransition({
      matchId: 12,
      goingCount: 1,
      threshold: 1,
      eventKey: "ready",
    }).text).toContain("Матч готов к подтверждению.");
    expect(thresholdReachedNotificationTransition({
      matchId: 12,
      goingCount: 1,
      threshold: 1,
      eventKey: "ready-without-brand",
    }).text).not.toContain("Ballimus");
    expect(lost).toMatchObject({ notificationType: "threshold_lost", transitionKey: "threshold:lost:2" });
    expect(lost.text).toBe(
      "⚠️ <b>Минимальный состав снова не набран</b>\n" +
      "<b>#v-100 · 02.08.2026 · BOX365</b>\n" +
      "👥 Игроков: <b>2 из 3</b>\n\n" +
      "↩️ Голос отменил: <b>@ivan</b>",
    );
    expect(formatConfirmationNotification({
      scheduledAt: new Date("2026-08-01T15:30:00.000Z"),
      location: "BOX365",
      fieldPriceRubles: 120,
      goingCount: 3,
      votes: [
        vote(1, "going", "Никита"),
        vote(2, "going", "Иван & Пётр"),
        vote(3, "maybe", "Максим"),
      ],
      timezone: MINSK_TIMEZONE,
    })).toBe(
      "⚽ <b>Состав набран — матч состоится!</b>\n\n" +
      "🗓 Суббота, 1 августа · 18:30\n" +
      "📍 BOX365\n" +
      "💰 Стоимость поля: 120 руб.\n" +
      "👥 Идут: 3 игрока\n\n" +
      '<a href="tg://user?id=1">Никита</a>, <a href="tg://user?id=2">Иван &amp; Пётр</a> — увидимся на поле!',
    );
    expect(formatCancellationNotification(9, "<дождь>")).toBe(
      "Матч #v9 отменён.\nПричина: &lt;дождь&gt;.",
    );
    expect(weatherForecastTransitionKey(-100, new Date("2026-08-02T17:00:00.000Z"))).toBe(
      "forecast:-100:2026-08-02",
    );
    expect(weatherForecastTransitionKey(-100, new Date("2026-08-02T18:00:00.000Z"))).toBe(
      "forecast:-100:2026-08-02",
    );
    expect(weatherForecastTransitionKey(-100, new Date("2026-08-02T21:30:00.000Z"))).toBe(
      "forecast:-100:2026-08-03",
    );
    expect(calendarDateInTimeZone(new Date("2026-08-02T17:00:00.000Z"))).toBe("2026-08-02");
    expect(calendarDateInTimeZone(new Date("2026-08-02T18:00:00.000Z"))).toBe("2026-08-02");
    expect(calendarDateInTimeZone(new Date("2026-08-02T21:30:00.000Z"))).toBe("2026-08-03");
  });
});
