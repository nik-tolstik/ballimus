import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MATCH_PARSER_MODEL,
  MatchParser,
  type MatchParserClient,
  buildMatchParserRequest,
} from "../../src/parser/match-parser.js";
import {
  DEFAULT_REQUIRED_PLAYERS,
  MATCH_DRAFT_SCHEMA_NAME,
} from "../../src/parser/match-schema.js";

const REFERENCE_NOW = new Date("2026-07-26T09:00:00.000Z");

function completion(payload: unknown): ChatCompletion {
  return {
    id: "test-completion",
    object: "chat.completion",
    created: 0,
    model: DEFAULT_MATCH_PARSER_MODEL,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify(payload),
        },
      },
    ],
  } as ChatCompletion;
}

function mockedParser(payload: unknown): {
  parser: MatchParser;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (request: ChatCompletionCreateParamsNonStreaming) => {
    void request;
    return completion(payload);
  });
  const client: MatchParserClient = {
    chat: {
      completions: { create },
    },
  };

  return {
    parser: new MatchParser({
      timezone: "Europe/Minsk",
      now: REFERENCE_NOW,
      client,
    }),
    create,
  };
}

describe("match parser request", () => {
  it("builds an OpenRouter strict JSON Schema request with parser-only instructions", () => {
    const request = buildMatchParserRequest({
      command: "/match 27 июля 20:00 СОК Олимпийский. 10 человек",
      timezone: "Europe/Minsk",
      now: REFERENCE_NOW,
    });

    expect(request.model).toBe(DEFAULT_MATCH_PARSER_MODEL);
    expect(request.stream).toBe(false);
    expect(request).not.toHaveProperty("tools");
    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: MATCH_DRAFT_SCHEMA_NAME,
        strict: true,
        schema: expect.objectContaining({
          type: "object",
          additionalProperties: false,
          required: ["date", "time", "location", "requiredPlayers", "venueType"],
        }),
      },
    });

    const systemMessage = request.messages[0];
    expect(systemMessage?.role).toBe("system");
    expect(systemMessage?.content).toContain("Europe/Minsk");
    expect(systemMessage?.content).toContain("2026-07-26");
    expect(systemMessage?.content).toContain("12:00");
    expect(systemMessage?.content).toContain("Do not call tools");
  });
});

describe("Russian /match parsing", () => {
  it("parses the labelled template without calling the language model", async () => {
    const parser = new MatchParser({
      timezone: "Europe/Minsk",
      now: REFERENCE_NOW,
    });

    await expect(
      parser.parse(
        [
          "/match",
          "Дата: 03.08.2026",
          "Время: 20:00",
          "Место: Ракета",
          "Формат: на улице",
          "Нужно игроков: 10",
          "Цена поля: 100 рублей",
        ].join("\n"),
      ),
    ).resolves.toEqual({
      status: "ok",
      draft: {
        date: "2026-08-03",
        time: "20:00",
        location: "Ракета",
        venueType: "outdoor",
        requiredPlayers: 10,
        fieldPriceRubles: 100,
      },
    });
  });

  it("accepts an indoor venue in the labelled template", async () => {
    const parser = new MatchParser({
      timezone: "Europe/Minsk",
      now: REFERENCE_NOW,
    });

    await expect(
      parser.parse(
        [
          "/match",
          "Дата: 03.08.2026",
          "Время: 20:00",
          "Место: Манеж",
          "Формат: в здании",
        ].join("\n"),
      ),
    ).resolves.toEqual({
      status: "ok",
      draft: {
        date: "2026-08-03",
        time: "20:00",
        location: "Манеж",
        venueType: "indoor",
        requiredPlayers: DEFAULT_REQUIRED_PLAYERS,
      },
    });
  });

  it("asks for the venue format when the labelled template omits it", async () => {
    const parser = new MatchParser({
      timezone: "Europe/Minsk",
      now: REFERENCE_NOW,
    });

    const result = await parser.parse(
      [
        "/match",
        "Дата: 03.08.2026",
        "Время: 20:00",
        "Место: Ракета",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      status: "clarification",
      reasons: [{ field: "venueType", kind: "missing" }],
    });
  });

  it("rejects an unknown venue format in the labelled template", async () => {
    const parser = new MatchParser({
      timezone: "Europe/Minsk",
      now: REFERENCE_NOW,
    });

    const result = await parser.parse(
      [
        "/match",
        "Дата: 03.08.2026",
        "Время: 20:00",
        "Место: Ракета",
        "Формат: на крыше",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      status: "clarification",
      reasons: [{ field: "venueType", kind: "invalid" }],
    });
  });

  it("parses the canonical command", async () => {
    const { parser } = mockedParser({
      date: "2026-07-27",
      time: "20:00",
      location: "СОК Олимпийский",
      requiredPlayers: 10,
    });

    await expect(parser.parse("/match 27 июля 20:00 СОК Олимпийский. 10 человек")).resolves.toEqual({
      status: "ok",
      draft: {
        date: "2026-07-27",
        dateLabel: "27 июля",
        time: "20:00",
        location: "СОК Олимпийский",
        requiredPlayers: 10,
      },
    });
  });

  it("uses ten players when the threshold is omitted", async () => {
    const { parser } = mockedParser({
      date: "2026-07-27",
      time: "20:00",
      location: "Стадион Труд",
      requiredPlayers: null,
    });

    const result = await parser.parse("/match 27 июля 20:00 Стадион Труд");

    expect(result).toEqual({
      status: "ok",
      draft: {
        date: "2026-07-27",
        dateLabel: "27 июля",
        time: "20:00",
        location: "Стадион Труд",
        requiredPlayers: DEFAULT_REQUIRED_PLAYERS,
      },
    });
  });

  it("preserves spaces in a multi-word location and normalizes whitespace", async () => {
    const { parser } = mockedParser({
      date: "27 июля 2026",
      time: "20.00",
      location: "  ФОК   Олимпийский, поле 2. ",
      requiredPlayers: 12,
    });

    const result = await parser.parse("/match 27 июля 20:00 ФОК Олимпийский, поле 2. 12 игроков");

    expect(result).toEqual({
      status: "ok",
      draft: {
        date: "2026-07-27",
        dateLabel: "27 июля",
        time: "20:00",
        location: "ФОК Олимпийский, поле 2",
        requiredPlayers: 12,
      },
    });
  });

  it("resolves завтра relative to the configured local date", async () => {
    const { parser } = mockedParser({
      date: "завтра",
      time: "8 вечера",
      location: "Манеж",
      requiredPlayers: 8,
    });

    await expect(parser.parse("/match завтра в 20:00 Манеж 8 человек")).resolves.toMatchObject({
      status: "ok",
      draft: {
        date: "2026-07-27",
        dateLabel: "Завтра",
        time: "20:00",
        location: "Манеж",
        requiredPlayers: 8,
      },
    });
  });

  it("accepts a numeric Russian date and local time", async () => {
    const { parser } = mockedParser({
      date: "27.07.2026",
      time: "09:30",
      location: "Парк Победы",
      requiredPlayers: 7,
    });

    await expect(parser.parse("/match 27.07.2026 в 09:30 Парк Победы 7 человек")).resolves.toMatchObject({
      status: "ok",
      draft: { date: "2026-07-27", time: "09:30", requiredPlayers: 7 },
    });
  });

  it("allows a match when the location is missing", async () => {
    const { parser } = mockedParser({
      date: "2026-07-27",
      time: "20:00",
      location: null,
      requiredPlayers: null,
    });

    const result = await parser.parse("/match 27 июля 20:00");

    expect(result).toEqual({
      status: "ok",
      draft: {
        date: "2026-07-27",
        dateLabel: "27 июля",
        time: "20:00",
        location: null,
        requiredPlayers: DEFAULT_REQUIRED_PLAYERS,
      },
    });
  });

  it("allows an approximate time and a missing location", async () => {
    const { parser } = mockedParser({
      date: "2026-07-28",
      time: "20:00",
      location: "Ракета",
      requiredPlayers: 1,
    });

    const result = await parser.parse("/match 28 июля после 20:00. 1 человек.");

    expect(result).toEqual({
      status: "ok",
      draft: {
        date: "2026-07-28",
        dateLabel: "28 июля",
        time: null,
        timeLabel: "после 20:00",
        location: null,
        requiredPlayers: 1,
      },
    });
  });

  it("separates the field price from the location", async () => {
    const { parser } = mockedParser({
      date: "2026-07-30",
      time: "20:00-21:30",
      location: "BOX365, 100 рублей",
      requiredPlayers: 1,
    });

    await expect(
      parser.parse("/match четверг 20:00-21:30 BOX365 100 рублей. 1 человек"),
    ).resolves.toEqual({
      status: "ok",
      draft: {
        date: "2026-07-30",
        dateLabel: "Четверг",
        time: null,
        timeLabel: "20:00-21:30",
        location: "BOX365",
        fieldPriceRubles: 100,
        requiredPlayers: 1,
      },
    });
  });

  it("allows a match when the time is missing", async () => {
    const { parser } = mockedParser({
      date: "2026-07-27",
      time: null,
      location: "Стадион",
      requiredPlayers: null,
    });

    const result = await parser.parse("/match 27 июля Стадион");

    expect(result).toEqual({
      status: "ok",
      draft: {
        date: "2026-07-27",
        dateLabel: "27 июля",
        time: null,
        location: "Стадион",
        requiredPlayers: DEFAULT_REQUIRED_PLAYERS,
      },
    });
  });

  it("returns clarification when the date is missing", async () => {
    const { parser } = mockedParser({
      date: null,
      time: "20:00",
      location: "Стадион",
      requiredPlayers: null,
    });

    const result = await parser.parse("/match 20:00 Стадион");

    expect(result.status).toBe("clarification");
    expect(result).toMatchObject({ reasons: [{ field: "date", kind: "missing" }] });
  });

  it("rejects a malformed or out-of-range threshold", async () => {
    const { parser } = mockedParser({
      date: "2026-07-27",
      time: "20:00",
      location: "Стадион",
      requiredPlayers: 0,
    });

    const result = await parser.parse("/match 27 июля 20:00 Стадион. много человек");

    expect(result.status).toBe("clarification");
    expect(result).toMatchObject({ reasons: [{ field: "requiredPlayers", kind: "invalid" }] });
  });

  it("marks an unresolved weekday as ambiguous", async () => {
    const { parser } = mockedParser({
      date: null,
      time: "20:00",
      location: "Стадион",
      requiredPlayers: null,
    });

    const result = await parser.parse("/match в пятницу 20:00 Стадион");

    expect(result.status).toBe("clarification");
    expect(result).toMatchObject({ reasons: [{ field: "date", kind: "ambiguous" }] });
  });

  it("rejects an impossible ISO date during deterministic post-validation", async () => {
    const { parser } = mockedParser({
      date: "2026-02-30",
      time: "20:00",
      location: "Стадион",
      requiredPlayers: 10,
    });

    const result = await parser.parse("/match 30 февраля 20:00 Стадион");

    expect(result).toMatchObject({ status: "clarification", reasons: [{ field: "date", kind: "invalid" }] });
  });

  it("rejects an invalid local time and a too-short location", async () => {
    const { parser } = mockedParser({
      date: "2026-07-27",
      time: "25:61",
      location: "X",
      requiredPlayers: 10,
    });

    const result = await parser.parse("/match 27 июля 25:61 X");

    expect(result.status).toBe("clarification");
    expect(result).toMatchObject({
      reasons: [
        { field: "time", kind: "invalid" },
        { field: "location", kind: "invalid" },
      ],
    });
  });

  it("returns clarification for an invalid strict model response", async () => {
    const { parser, create } = mockedParser({
      date: "2026-07-27",
      time: "20:00",
      location: "Стадион",
      requiredPlayers: 10,
      unexpected: "not allowed",
    });

    const result = await parser.parse("/match 27 июля 20:00 Стадион");

    expect(create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "clarification", reasons: [{ field: "response", kind: "invalid" }] });
  });
});
