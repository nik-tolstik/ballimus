import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { DateTime } from "luxon";

import {
  DEFAULT_REQUIRED_PLAYERS,
  ISO_DATE_PATTERN,
  MAX_REQUIRED_PLAYERS,
  MAX_LOCATION_LENGTH,
  MIN_REQUIRED_PLAYERS,
  MIN_LOCATION_LENGTH,
  MATCH_DRAFT_SCHEMA_NAME,
  matchDraftJsonSchema,
  matchDraftSchema,
  normalizedMatchDraftSchema,
  type MatchDraft,
  type MatchVenueType,
} from "./match-schema.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MATCH_PARSER_MODEL = "openai/gpt-4.1-mini";

export type MatchClarificationField =
  | "date"
  | "time"
  | "location"
  | "venueType"
  | "requiredPlayers"
  | "response";
export type MatchClarificationKind = "missing" | "ambiguous" | "invalid";

export interface MatchClarificationReason {
  readonly field: MatchClarificationField;
  readonly kind: MatchClarificationKind;
  readonly message: string;
}

export interface MatchClarificationResult {
  readonly status: "clarification";
  readonly reasons: readonly MatchClarificationReason[];
  readonly message: string;
}

export interface MatchParseSuccess {
  readonly status: "ok";
  readonly draft: MatchDraft;
}

export type MatchParseResult = MatchParseSuccess | MatchClarificationResult;

/** A narrow OpenAI-compatible client contract that is straightforward to mock. */
export interface MatchParserClient {
  chat: {
    completions: {
      create(request: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
    };
  };
}

export interface MatchParserOptions {
  readonly timezone: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly defaultRequiredPlayers?: number;
  readonly now?: Date | (() => Date);
  readonly client?: MatchParserClient;
}

export interface MatchParserRequestOptions {
  readonly command: string;
  readonly timezone: string;
  readonly now: Date;
  readonly model?: string;
  readonly defaultRequiredPlayers?: number;
}

export class MatchParserConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MatchParserConfigurationError";
  }
}

const RUSSIAN_MONTHS: Readonly<Record<string, number>> = {
  январь: 1,
  января: 1,
  февраль: 2,
  февраля: 2,
  март: 3,
  марта: 3,
  апрель: 4,
  апреля: 4,
  май: 5,
  мая: 5,
  июнь: 6,
  июня: 6,
  июль: 7,
  июля: 7,
  август: 8,
  августа: 8,
  сентябрь: 9,
  сентября: 9,
  октябрь: 10,
  октября: 10,
  ноябрь: 11,
  ноября: 11,
  декабрь: 12,
  декабря: 12,
};

const RUSSIAN_NUMBER_WORDS: Readonly<Record<string, number>> = {
  ноль: 0,
  один: 1,
  одна: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80,
  девяносто: 90,
  сто: 100,
};

const THRESHOLD_PATTERN = /([+-]?\d+(?:[.,]\d+)?|[^\s.,]+)\s*(?:человек(?:а|ов)?|чел(?:овек)?\.?|игрок(?:а|ов)?)/iu;
const FIELD_PRICE_PATTERN = /([0-9]+(?:[.,][0-9]+)?)\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.)/iu;
const DATE_HINT_PATTERN = /(?:сегодня|завтра|послезавтра|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|понедельник|вторник|сред|четверг|пятниц|суббот|воскресен|\b\d{1,2}[./-]\d{1,2}\b)/iu;
const DATE_LABEL_PATTERN = /(?:послезавтра|сегодня|завтра|\d{1,2}\s+(?:январ(?:я|ь)?|феврал(?:я|ь)?|март(?:а)?|апрел(?:я|ь)?|мая?|июн(?:я|ь)?|июл(?:я|ь)?|август(?:а)?|сентябр(?:я|ь)?|октябр(?:я|ь)?|ноябр(?:я|ь)?|декабр(?:я|ь)?)(?:\s+\d{4})?|понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье)/iu;
const TIME_HINT_PATTERN = /\b(?:2[0-3]|[01]?\d)(?:[:.]\d{1,2})?\s*(?:час(?:а|ов)?|ч\.?|утра|дня|вечера|ночи)?\b/iu;
const APPROXIMATE_TIME_PATTERN = /(?:после|до|около|примерно|приблизительно|ориентировочно|не\s+(?:раньше|позже)|в\s+районе)\s+(?:2[0-3]|[01]?\d)(?:[:.]\d{1,2})?(?:\s*(?:час(?:а|ов)?|ч\.?|утра|дня|вечера|ночи))?/iu;
const TIME_RANGE_PATTERN = /(?:с|от)?\s*(?:2[0-3]|[01]?\d)(?:[:.]\d{1,2})?\s*(?:до|[-–—])\s*(?:2[0-3]|[01]?\d)(?:[:.]\d{1,2})?/iu;

function normalizedText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function stripMatchCommand(command: string): string {
  return normalizedText(command).replace(/^\/match(?:@[-\w]+)?(?:\s+|$)/iu, "").trim();
}

function stripMatchCommandPreservingLines(command: string): string {
  return command
    .normalize("NFC")
    .replace(/^\s*\/match(?:@[-\w]+)?[ \t]*(?:\r?\n)?/iu, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function resolveLocalDateTime(now: Date, timezone: string): DateTime {
  if (Number.isNaN(now.getTime())) {
    throw new MatchParserConfigurationError("The parser reference time must be a valid Date");
  }

  const local = DateTime.fromJSDate(now, { zone: timezone });
  if (!local.isValid) {
    throw new MatchParserConfigurationError("The parser timezone must be a valid IANA timezone");
  }

  return local;
}

function formatReferenceDateTime(now: Date, timezone: string): string {
  const local = resolveLocalDateTime(now, timezone);
  const iso = local.toISO({ suppressMilliseconds: true });
  if (iso === null) {
    throw new MatchParserConfigurationError("The parser reference time could not be formatted");
  }

  return iso;
}

function buildSystemPrompt(options: MatchParserRequestOptions): string {
  const local = resolveLocalDateTime(options.now, options.timezone);
  const localDate = local.toISODate();
  const localTime = local.toFormat("HH:mm");
  if (localDate === null) {
    throw new MatchParserConfigurationError("The parser reference date could not be formatted");
  }

  const defaultRequiredPlayers = options.defaultRequiredPlayers ?? DEFAULT_REQUIRED_PLAYERS;

  return [
    "You are a strict Russian-language football match parser.",
    "Parse only the supplied /match text. Do not call tools, access Telegram, create anything, or make business decisions.",
    "Return exactly one JSON object matching the supplied schema.",
    "Normalize a Russian date to YYYY-MM-DD using the configured timezone and reference date; resolve relative dates such as завтра.",
    "Normalize a local time to HH:mm without converting it to UTC.",
    "Trim surrounding whitespace from the location while preserving meaningful spaces inside it.",
    "Set venueType to outdoor for 'на улице' and indoor for 'в здании'. If the venue format is absent or ambiguous, return null for venueType.",
    "A monetary amount such as 100 рублей is the total field price, not part of the location name; keep it separate from the location.",
    `If the player count is omitted, return null; the application will use ${defaultRequiredPlayers}.`,
    "For a missing or genuinely ambiguous date, time, or location, return null for that field instead of guessing.",
    "Treat approximate times, time ranges, and boundaries such as после 20:00, около 20:00, с 20:00 до 21:00, до 20:00, or after 20:00 as ambiguous and return null for time.",
    `Reference local date: ${localDate}. Reference local time: ${localTime}. Reference ISO date-time: ${formatReferenceDateTime(options.now, options.timezone)}. Timezone: ${options.timezone}.`,
  ].join(" ");
}

/** Build the exact non-streaming structured-output request sent to OpenRouter. */
export function buildMatchParserRequest(
  options: MatchParserRequestOptions,
): ChatCompletionCreateParamsNonStreaming {
  const command = stripMatchCommand(options.command);
  const model = options.model ?? DEFAULT_MATCH_PARSER_MODEL;

  return {
    model,
    stream: false,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(options),
      },
      {
        role: "user",
        content: command,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: MATCH_DRAFT_SCHEMA_NAME,
        strict: true,
        schema: matchDraftJsonSchema,
      },
    },
    temperature: 0,
  };
}

function normalizeDate(value: string, reference: DateTime): string | undefined {
  const text = normalizedText(value).toLocaleLowerCase("ru-RU").replace(/ё/gu, "е");
  if (text === "сегодня") return reference.toISODate() ?? undefined;
  if (text === "завтра") return reference.plus({ days: 1 }).toISODate() ?? undefined;
  if (text === "послезавтра") return reference.plus({ days: 2 }).toISODate() ?? undefined;

  if (new RegExp(ISO_DATE_PATTERN).test(text)) {
    const parsed = DateTime.fromISO(text, { zone: reference.zoneName });
    return parsed.isValid ? parsed.toISODate() ?? undefined : undefined;
  }

  const numericMatch = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/.exec(text);
  if (numericMatch !== null) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const explicitYear = numericMatch[3] === undefined ? undefined : Number(numericMatch[3]);
    return dateFromParts(day, month, explicitYear, reference);
  }

  const russianMatch = /^(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?$/.exec(text.replace(/,/gu, ""));
  if (russianMatch !== null) {
    const day = Number(russianMatch[1]);
    const month = RUSSIAN_MONTHS[russianMatch[2] ?? ""];
    const explicitYear = russianMatch[3] === undefined ? undefined : Number(russianMatch[3]);
    if (month !== undefined) return dateFromParts(day, month, explicitYear, reference);
  }

  return undefined;
}

function dateFromParts(day: number, month: number, explicitYear: number | undefined, reference: DateTime): string | undefined {
  let year = explicitYear ?? reference.year;
  let candidate = DateTime.fromObject({ year, month, day }, { zone: reference.zoneName });
  if (!candidate.isValid) return undefined;

  if (explicitYear === undefined && candidate < reference.startOf("day")) {
    year += 1;
    candidate = DateTime.fromObject({ year, month, day }, { zone: reference.zoneName });
  }

  return candidate.isValid ? candidate.toISODate() ?? undefined : undefined;
}

function normalizeTime(value: string): string | undefined {
  const text = normalizedText(value).toLocaleLowerCase("ru-RU").replace(/,/gu, ".");
  let hour: number;
  let minute = 0;

  const clockMatch = /^(\d{1,2})[:.](\d{1,2})$/.exec(text);
  if (clockMatch !== null) {
    hour = Number(clockMatch[1]);
    minute = Number(clockMatch[2]);
  } else {
    const hourMatch = /^(\d{1,2})(?:\s*(?:час(?:а|ов)?|ч\.?))?(?:\s+(утра|дня|вечера|ночи))?$/.exec(text);
    if (hourMatch === null) return undefined;
    hour = Number(hourMatch[1]);
    const period = hourMatch[2];
    if (period === "вечера" && hour < 12) hour += 12;
    if (period === "ночи" && hour === 12) hour = 0;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeLocation(value: string): string | undefined {
  const text = normalizedText(value)
    .replace(FIELD_PRICE_PATTERN, " ")
    .replace(/\(\s*\)/gu, " ")
    .replace(/[.,;:!?]+\s*$/u, "")
    .trim();
  return text === "" ? undefined : text;
}

type CanonicalMatchField =
  | "date"
  | "time"
  | "location"
  | "venueType"
  | "requiredPlayers"
  | "fieldPriceRubles";

const CANONICAL_MATCH_FIELD_NAMES: Readonly<Record<string, CanonicalMatchField>> = {
  "дата": "date",
  "время": "time",
  "место": "location",
  "формат": "venueType",
  "нужно игроков": "requiredPlayers",
  "игроков": "requiredPlayers",
  "цена поля": "fieldPriceRubles",
};

function canonicalFieldName(value: string): CanonicalMatchField | undefined {
  return CANONICAL_MATCH_FIELD_NAMES[normalizedText(value).toLocaleLowerCase("ru-RU")];
}

function canonicalVenueType(value: string): MatchVenueType | undefined {
  const normalized = normalizedText(value).toLocaleLowerCase("ru-RU");
  if (normalized === "на улице") return "outdoor";
  if (normalized === "в здании") return "indoor";
  return undefined;
}

function canonicalPlayerCount(value: string): number | undefined {
  const match = /^(\d+)(?:\s*(?:игрок(?:а|ов)?|человек(?:а|ов)?))?$/iu.exec(
    normalizedText(value),
  );
  if (match?.[1] === undefined) return undefined;

  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= MIN_REQUIRED_PLAYERS && parsed <= MAX_REQUIRED_PLAYERS
    ? parsed
    : undefined;
}

function canonicalFieldPrice(value: string): number | undefined {
  const match = /^(\d+)(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.))?$/iu.exec(
    normalizedText(value),
  );
  if (match?.[1] === undefined) return undefined;

  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Parses the labelled /match template before falling back to the language model.
 * Returning undefined means that the text did not use the template at all.
 */
function parseCanonicalMatchCommand(
  command: string,
  reference: DateTime,
  defaultRequiredPlayers: number,
): MatchParseResult | undefined {
  const body = stripMatchCommandPreservingLines(command);
  if (body === "" || !body.includes("\n")) return undefined;

  const values = new Map<CanonicalMatchField, string>();
  let recognizedField = false;
  let hasDuplicateField = false;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    const match = /^([^:]+):\s*(.*)$/u.exec(line);
    if (match?.[1] === undefined) continue;

    const field = canonicalFieldName(match[1]);
    if (field === undefined) continue;

    recognizedField = true;
    if (values.has(field)) {
      hasDuplicateField = true;
      continue;
    }
    values.set(field, match[2] ?? "");
  }

  if (!recognizedField) return undefined;

  const reasons: MatchClarificationReason[] = [];
  if (hasDuplicateField) addReason(reasons, "response", "invalid");

  const dateValue = values.get("date");
  let date: string | undefined;
  if (dateValue === undefined || normalizedText(dateValue) === "") {
    addReason(reasons, "date", "missing");
  } else {
    date = normalizeDate(dateValue, reference);
    if (date === undefined) addReason(reasons, "date", "invalid");
  }

  const timeValue = values.get("time");
  let time: string | null = null;
  if (timeValue !== undefined && normalizedText(timeValue) !== "") {
    time = normalizeTime(timeValue) ?? null;
    if (time === null) addReason(reasons, "time", "invalid");
  }

  const locationValue = values.get("location");
  let location: string | null = null;
  if (locationValue !== undefined && normalizedText(locationValue) !== "") {
    location = normalizeLocation(locationValue) ?? null;
    if (
      location === null ||
      location.length < MIN_LOCATION_LENGTH ||
      location.length > MAX_LOCATION_LENGTH
    ) {
      addReason(reasons, "location", "invalid");
    }
  }

  const venueValue = values.get("venueType");
  let venueType: MatchVenueType | undefined;
  if (venueValue === undefined || normalizedText(venueValue) === "") {
    addReason(reasons, "venueType", "missing");
  } else {
    venueType = canonicalVenueType(venueValue);
    if (venueType === undefined) addReason(reasons, "venueType", "invalid");
  }

  const playerCountValue = values.get("requiredPlayers");
  let requiredPlayers = defaultRequiredPlayers;
  if (playerCountValue !== undefined && normalizedText(playerCountValue) !== "") {
    const parsed = canonicalPlayerCount(playerCountValue);
    if (parsed === undefined) addReason(reasons, "requiredPlayers", "invalid");
    else requiredPlayers = parsed;
  }

  const priceValue = values.get("fieldPriceRubles");
  let fieldPriceRubles: number | undefined;
  if (priceValue !== undefined) {
    fieldPriceRubles = canonicalFieldPrice(priceValue);
    if (fieldPriceRubles === undefined) addReason(reasons, "response", "invalid");
  }

  if (reasons.length > 0) return clarification(reasons);

  const validated = normalizedMatchDraftSchema.safeParse({
    date,
    time,
    location,
    venueType,
    requiredPlayers,
  });
  if (!validated.success) {
    const finalReasons: MatchClarificationReason[] = [];
    for (const issue of validated.error.issues) {
      const field = issue.path[0];
      if (
        field === "date" ||
        field === "time" ||
        field === "location" ||
        field === "venueType" ||
        field === "requiredPlayers"
      ) {
        addReason(finalReasons, field, "invalid");
      }
    }
    if (finalReasons.length === 0) addReason(finalReasons, "response", "invalid");
    return clarification(finalReasons);
  }

  const draft: MatchDraft = {
    ...validated.data,
    ...(fieldPriceRubles === undefined ? {} : { fieldPriceRubles }),
  };

  return { status: "ok", draft };
}

function parsePlayerCountToken(token: string): number | undefined {
  const numeric = Number(token.replace(",", "."));
  if (token !== "" && Number.isFinite(numeric)) return numeric;
  return RUSSIAN_NUMBER_WORDS[token.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е")];
}

interface PlayerCountHint {
  readonly value?: number;
  readonly invalid: boolean;
}

function playerCountHint(command: string): PlayerCountHint {
  const match = THRESHOLD_PATTERN.exec(stripMatchCommand(command));
  if (match === null) return { invalid: false };

  const token = match[1];
  if (token === undefined) return { invalid: true };
  const value = parsePlayerCountToken(token);
  if (value === undefined) return { invalid: true };
  if (!Number.isInteger(value) || value < MIN_REQUIRED_PLAYERS || value > MAX_REQUIRED_PLAYERS) {
    return { invalid: true };
  }

  return { value, invalid: false };
}

function fieldPriceHint(command: string): number | undefined {
  const match = FIELD_PRICE_PATTERN.exec(stripMatchCommand(command));
  const valueText = match?.[1];
  if (valueText === undefined) return undefined;

  const value = Number(valueText.replace(",", "."));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function dateLabelHint(command: string): string | undefined {
  const match = DATE_LABEL_PATTERN.exec(stripMatchCommand(command));
  const label = match?.[0]
    ?.replace(/[.,;:!?]+$/u, "")
    .trim();
  if (label === undefined || label === "") return undefined;

  return label.charAt(0).toLocaleUpperCase("ru-RU") + label.slice(1);
}

function timeLabelHint(command: string): string | undefined {
  const text = stripMatchCommand(command);
  const match = APPROXIMATE_TIME_PATTERN.exec(text) ?? TIME_RANGE_PATTERN.exec(text);
  const label = match?.[0]
    ?.replace(/[.,;!?]+$/u, "")
    .trim();
  return label === undefined || label === "" ? undefined : label;
}

function likelyHasDateHint(command: string): boolean {
  return DATE_HINT_PATTERN.test(stripMatchCommand(command));
}

function likelyHasTimeHint(command: string): boolean {
  return TIME_HINT_PATTERN.test(stripMatchCommand(command));
}

function likelyHasLocationHint(command: string): boolean {
  const text = stripMatchCommand(command);
  const timeMatch = TIME_HINT_PATTERN.exec(text);
  if (timeMatch === null) return false;
  const trailing = text
    .slice(timeMatch.index + timeMatch[0].length)
    .replace(THRESHOLD_PATTERN, " ")
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/gu, "")
    .trim();
  return trailing !== "";
}

function likelyHasAmbiguousTimeHint(command: string): boolean {
  const text = stripMatchCommand(command);
  return APPROXIMATE_TIME_PATTERN.test(text) || TIME_RANGE_PATTERN.test(text);
}

function missingOrAmbiguousKind(field: Exclude<MatchClarificationField, "requiredPlayers" | "response">, command: string): MatchClarificationKind {
  if (field === "date") return likelyHasDateHint(command) ? "ambiguous" : "missing";
  if (field === "time") return likelyHasTimeHint(command) ? "ambiguous" : "missing";
  return likelyHasLocationHint(command) ? "ambiguous" : "missing";
}

function addReason(
  reasons: MatchClarificationReason[],
  field: MatchClarificationField,
  kind: MatchClarificationKind,
): void {
  if (reasons.some((reason) => reason.field === field)) return;

  const messages: Record<MatchClarificationField, string> = {
    date: kind === "missing" ? "Уточните дату матча." : "Уточните дату матча однозначно.",
    time: kind === "missing" ? "Уточните местное время матча." : "Уточните время матча однозначно.",
    location: kind === "missing" ? "Уточните место матча." : "Уточните место матча однозначно.",
    venueType:
      kind === "missing"
        ? "Укажите формат: на улице или в здании."
        : "Формат матча должен быть: на улице или в здании.",
    requiredPlayers:
      kind === "invalid"
        ? `Укажите целое число игроков от ${MIN_REQUIRED_PLAYERS} до ${MAX_REQUIRED_PLAYERS}.`
        : "Уточните количество игроков.",
    response: "Не удалось разобрать данные матча. Повторите команду с датой, временем и местом.",
  };

  reasons.push({ field, kind, message: messages[field] });
}

function clarification(reasons: MatchClarificationReason[]): MatchClarificationResult {
  return {
    status: "clarification",
    reasons,
    message: reasons.map((reason) => reason.message).join(" "),
  };
}

function parseCompletionContent(response: ChatCompletion): unknown {
  const content = response.choices[0]?.message.content;
  if (typeof content !== "string" || content.trim() === "") return undefined;

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function validateDefaultRequiredPlayers(value: number): void {
  if (!Number.isInteger(value) || value < MIN_REQUIRED_PLAYERS || value > MAX_REQUIRED_PLAYERS) {
    throw new MatchParserConfigurationError(
      `defaultRequiredPlayers must be an integer from ${MIN_REQUIRED_PLAYERS} to ${MAX_REQUIRED_PLAYERS}`,
    );
  }
}

export class MatchParser {
  private readonly client: MatchParserClient | undefined;
  private readonly timezone: string;
  private readonly model: string;
  private readonly defaultRequiredPlayers: number;
  private readonly now: Date | (() => Date);

  public constructor(options: MatchParserOptions) {
    this.timezone = options.timezone;
    this.model = options.model ?? DEFAULT_MATCH_PARSER_MODEL;
    this.defaultRequiredPlayers = options.defaultRequiredPlayers ?? DEFAULT_REQUIRED_PLAYERS;
    this.now = options.now ?? (() => new Date());
    validateDefaultRequiredPlayers(this.defaultRequiredPlayers);
    resolveLocalDateTime(new Date(), this.timezone);

    if (options.client !== undefined) {
      this.client = options.client;
      return;
    }

    if (options.apiKey === undefined || options.apiKey.trim() === "") {
      this.client = undefined;
      return;
    }

    const openRouterClient = new OpenAI({
      apiKey: options.apiKey,
      baseURL: OPENROUTER_BASE_URL,
    });
    this.client = {
      chat: {
        completions: {
          create: (request) => openRouterClient.chat.completions.create(request),
        },
      },
    };
  }

  public async parse(command: string): Promise<MatchParseResult> {
    const commandText = stripMatchCommand(command);
    if (commandText === "") {
      const reasons: MatchClarificationReason[] = [];
      addReason(reasons, "date", "missing");
      addReason(reasons, "time", "missing");
      addReason(reasons, "location", "missing");
      return clarification(reasons);
    }

    const referenceTime = typeof this.now === "function" ? this.now() : this.now;
    const canonicalResult = parseCanonicalMatchCommand(
      command,
      resolveLocalDateTime(referenceTime, this.timezone),
      this.defaultRequiredPlayers,
    );
    if (canonicalResult !== undefined) return canonicalResult;

    if (this.client === undefined) {
      throw new MatchParserConfigurationError(
        "An OpenRouter API key or injected parser client is required for free-form match commands",
      );
    }

    const request = buildMatchParserRequest({
      command,
      timezone: this.timezone,
      now: referenceTime,
      model: this.model,
      defaultRequiredPlayers: this.defaultRequiredPlayers,
    });
    const response = await this.client.chat.completions.create(request);
    const parsed = parseCompletionContent(response);
    const modelResult = matchDraftSchema.safeParse(parsed);
    if (!modelResult.success) {
      const reasons: MatchClarificationReason[] = [];
      addReason(reasons, "response", "invalid");
      return clarification(reasons);
    }

    return this.normalizeAndValidate(command, modelResult.data, referenceTime);
  }

  private normalizeAndValidate(
    command: string,
    modelDraft: ReturnType<typeof matchDraftSchema.parse>,
    referenceTime: Date,
  ): MatchParseResult {
    const reference = resolveLocalDateTime(referenceTime, this.timezone);
    const reasons: MatchClarificationReason[] = [];
    const thresholdHint = playerCountHint(command);
    const priceHint = fieldPriceHint(command);
    const dateLabel = dateLabelHint(command);
    const timeLabel = timeLabelHint(command);

    if (thresholdHint.invalid) addReason(reasons, "requiredPlayers", "invalid");

    let date: string | undefined;
    if (modelDraft.date === null) {
      addReason(reasons, "date", missingOrAmbiguousKind("date", command));
    } else {
      date = normalizeDate(modelDraft.date, reference);
      if (date === undefined) addReason(reasons, "date", "invalid");
    }

    let time: string | null = null;
    if (modelDraft.time !== null && !likelyHasAmbiguousTimeHint(command)) {
      const normalizedTime = normalizeTime(modelDraft.time);
      if (normalizedTime === undefined) addReason(reasons, "time", "invalid");
      else time = normalizedTime;
    }

    let location: string | null = null;
    const locationMissingFromCommand =
      likelyHasTimeHint(command) && !likelyHasLocationHint(command);
    if (!locationMissingFromCommand && modelDraft.location !== null) {
      const normalizedLocation = normalizeLocation(modelDraft.location);
      if (
        normalizedLocation === undefined ||
        normalizedLocation.length < MIN_LOCATION_LENGTH ||
        normalizedLocation.length > MAX_LOCATION_LENGTH
      ) {
        addReason(reasons, "location", "invalid");
      } else location = normalizedLocation;
    }

    const venueType = modelDraft.venueType ?? undefined;

    let requiredPlayers: number | undefined;
    if (!thresholdHint.invalid) {
      requiredPlayers = modelDraft.requiredPlayers ?? thresholdHint.value ?? this.defaultRequiredPlayers;
      if (
        !Number.isInteger(requiredPlayers) ||
        requiredPlayers < MIN_REQUIRED_PLAYERS ||
        requiredPlayers > MAX_REQUIRED_PLAYERS
      ) {
        addReason(reasons, "requiredPlayers", "invalid");
      }
    }

    if (reasons.length > 0) return clarification(reasons);

    const validated = normalizedMatchDraftSchema.safeParse({
      date,
      time,
      location,
      requiredPlayers,
      ...(venueType === undefined ? {} : { venueType }),
    });
    if (!validated.success) {
      const finalReasons: MatchClarificationReason[] = [];
      for (const issue of validated.error.issues) {
        const field = issue.path[0];
        if (
          field === "date" ||
          field === "time" ||
          field === "location" ||
          field === "venueType" ||
          field === "requiredPlayers"
        ) {
          addReason(finalReasons, field, "invalid");
        }
      }
      if (finalReasons.length === 0) addReason(finalReasons, "response", "invalid");
      return clarification(finalReasons);
    }

    const draft = {
      ...validated.data,
      ...(dateLabel === undefined ? {} : { dateLabel }),
      ...(timeLabel === undefined || time !== null ? {} : { timeLabel }),
    };

    return {
      status: "ok",
      draft:
        priceHint === undefined
          ? draft
          : { ...draft, fieldPriceRubles: priceHint },
    };
  }
}

export function createMatchParser(options: MatchParserOptions): MatchParser {
  return new MatchParser(options);
}

export async function parseMatch(command: string, options: MatchParserOptions): Promise<MatchParseResult> {
  return createMatchParser(options).parse(command);
}

export {
  matchDraftJsonSchema,
  matchDraftSchema,
  normalizedMatchDraftSchema,
  type MatchDraft,
};
