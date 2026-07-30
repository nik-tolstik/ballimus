import {
  matchStatuses,
  matchTimeModes,
  venueTypes,
  voteOptions,
  type DomainId,
  type ExternalParticipant,
  type Match,
  type MatchDraft,
  type MatchStatus,
  type MatchTimeMode,
  type VenueType,
  type Vote,
} from "./types.js";
import {
  MAX_AVAILABILITY_TIME_OPTIONS,
  MIN_AVAILABILITY_TIME_OPTIONS,
  isLocalTime,
  normalizeAvailabilityTimeOptions,
} from "./availability.js";

export const DEFAULT_REQUIRED_PLAYERS = 10;
export const MIN_REQUIRED_PLAYERS = 1;
export const MAX_REQUIRED_PLAYERS = 100;
export const MIN_LOCATION_LENGTH = 2;
export const MAX_LOCATION_LENGTH = 200;
export const MAX_MATCH_LABEL_LENGTH = 100;

export interface ValidationIssue {
  readonly path: string;
  readonly code: "invalid_type" | "missing" | "invalid_value" | "unknown_field";
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export class DomainValidationError extends Error {
  public readonly issues: readonly ValidationIssue[];

  public constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

interface DomainInput extends Record<string, unknown> {
  readonly date?: unknown;
  readonly time?: unknown;
  readonly timeMode?: unknown;
  readonly timeOptions?: unknown;
  readonly scheduleDate?: unknown;
  readonly selectedTime?: unknown;
  readonly location?: unknown;
  readonly venueType?: unknown;
  readonly requiredPlayers?: unknown;
  readonly fieldPriceRubles?: unknown;
  readonly dateLabel?: unknown;
  readonly timeLabel?: unknown;
  readonly id?: unknown;
  readonly chatId?: unknown;
  readonly scheduledAt?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly cancellationReason?: unknown;
  readonly creatorTelegramUserId?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
  readonly matchId?: unknown;
  readonly telegramUserId?: unknown;
  readonly displayNameSnapshot?: unknown;
  readonly usernameSnapshot?: unknown;
  readonly option?: unknown;
  readonly availableAfter?: unknown;
  readonly addedByTelegramUserId?: unknown;
  readonly quantity?: unknown;
  readonly sourceLabel?: unknown;
  readonly sourceUpdateId?: unknown;
}

function isRecord(value: unknown): value is DomainInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function addIssue(
  issues: ValidationIssue[],
  path: string,
  code: ValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function isDomainId(value: unknown): value is DomainId {
  if (typeof value === "bigint") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveDomainId(value: unknown): value is DomainId {
  if (!isDomainId(value)) return false;
  if (typeof value === "bigint") return value > 0n;
  if (typeof value === "number") return value > 0;
  return /^[1-9]\d*$/u.test(value.trim());
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function nullableText(
  input: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
  options: { required: boolean; maxLength?: number } = { required: false },
): string | null | undefined {
  if (!hasOwn(input, field)) {
    if (options.required) addIssue(issues, field, "missing", "value is required");
    return undefined;
  }

  const value = input[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    addIssue(issues, field, "invalid_type", "value must be a string or null");
    return undefined;
  }

  const normalized = normalizeText(value);
  if (options.maxLength !== undefined && normalized.length > options.maxLength) {
    addIssue(issues, field, "invalid_value", `value must be at most ${options.maxLength} characters`);
    return undefined;
  }
  return normalized === "" ? null : normalized;
}

function optionalLabel(
  input: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
): string | undefined {
  if (!hasOwn(input, field)) return undefined;
  const value = input[field];
  if (typeof value !== "string") {
    addIssue(issues, field, "invalid_type", "value must be a non-empty string");
    return undefined;
  }
  const normalized = normalizeText(value);
  if (normalized === "" || normalized.length > MAX_MATCH_LABEL_LENGTH) {
    addIssue(
      issues,
      field,
      "invalid_value",
      `value must contain 1-${MAX_MATCH_LABEL_LENGTH} characters`,
    );
    return undefined;
  }
  return normalized;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function isValidLocalTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function allowedKeys(input: Record<string, unknown>, keys: readonly string[], issues: ValidationIssue[]): void {
  for (const key of Object.keys(input)) {
    if (!keys.includes(key)) addIssue(issues, key, "unknown_field", "field is not supported");
  }
}

function enumValue<T extends string>(
  input: Record<string, unknown>,
  field: string,
  values: readonly T[],
  issues: ValidationIssue[],
  nullable = false,
): T | null | undefined {
  if (!hasOwn(input, field)) {
    if (!nullable) addIssue(issues, field, "missing", "value is required");
    return nullable ? null : undefined;
  }
  const value = input[field];
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !values.includes(value as T)) {
    addIssue(issues, field, "invalid_value", `value must be one of: ${values.join(", ")}`);
    return undefined;
  }
  return value as T;
}

function requiredInteger(
  input: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
  minimum: number,
  maximum: number,
): number | undefined {
  if (!hasOwn(input, field)) {
    addIssue(issues, field, "missing", "value is required");
    return undefined;
  }
  const value = input[field];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    addIssue(issues, field, "invalid_value", `value must be an integer from ${minimum} to ${maximum}`);
    return undefined;
  }
  return value;
}

function optionalNonNegativeInteger(
  input: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
): number | null | undefined {
  if (!hasOwn(input, field)) return undefined;
  const value = input[field];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    addIssue(issues, field, "invalid_value", "value must be a non-negative integer or null");
    return undefined;
  }
  return value;
}

export function validateMatchDraft(input: unknown): ValidationResult<MatchDraft> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ path: "<root>", code: "invalid_type", message: "draft must be an object" }],
    };
  }

  const issues: ValidationIssue[] = [];
  allowedKeys(
    input,
    [
      "date",
      "time",
      "timeMode",
      "timeOptions",
      "location",
      "venueType",
      "requiredPlayers",
      "fieldPriceRubles",
      "dateLabel",
      "timeLabel",
    ],
    issues,
  );

  const dateValue = input.date;
  let date: string | undefined;
  if (typeof dateValue !== "string") {
    addIssue(issues, "date", hasOwn(input, "date") ? "invalid_type" : "missing", "date must use YYYY-MM-DD");
  } else if (!isCalendarDate(dateValue)) {
    addIssue(issues, "date", "invalid_value", "date must be a real calendar date in YYYY-MM-DD format");
  } else {
    date = dateValue;
  }

  const timeValue = input.time;
  let time: string | null | undefined;
  if (!hasOwn(input, "time")) {
    addIssue(issues, "time", "missing", "time must be HH:mm or null");
  } else if (timeValue === null) {
    time = null;
  } else if (typeof timeValue !== "string" || !isValidLocalTime(timeValue)) {
    addIssue(issues, "time", "invalid_value", "time must use HH:mm or null");
  } else {
    time = timeValue;
  }

  const timeMode = hasOwn(input, "timeMode")
    ? enumValue(input, "timeMode", matchTimeModes, issues) as MatchTimeMode | undefined
    : "exact";
  let timeOptions: string[] | undefined;
  if (!hasOwn(input, "timeOptions")) {
    timeOptions = [];
  } else if (!Array.isArray(input.timeOptions) || input.timeOptions.some((value) => typeof value !== "string")) {
    addIssue(issues, "timeOptions", "invalid_type", "timeOptions must be an array of HH:mm values");
  } else {
    try {
      timeOptions = input.timeOptions.length === 0
        ? []
        : normalizeAvailabilityTimeOptions(input.timeOptions as string[]);
    } catch {
      addIssue(
        issues,
        "timeOptions",
        "invalid_value",
        `timeOptions must contain ${MIN_AVAILABILITY_TIME_OPTIONS}-${MAX_AVAILABILITY_TIME_OPTIONS} unique HH:mm values`,
      );
    }
  }
  if (timeMode === "availability" && time !== null) {
    addIssue(issues, "time", "invalid_value", "time must be null in availability mode");
  }
  if (timeMode === "availability" && (timeOptions?.length ?? 0) < MIN_AVAILABILITY_TIME_OPTIONS) {
    addIssue(issues, "timeOptions", "invalid_value", "availability mode requires at least two time options");
  }
  if (timeMode === "exact" && (timeOptions?.length ?? 0) > 0) {
    addIssue(issues, "timeOptions", "invalid_value", "exact mode cannot contain availability time options");
  }

  const location = nullableText(input, "location", issues, {
    required: true,
    maxLength: MAX_LOCATION_LENGTH,
  });
  if (location !== undefined && location !== null && location.length < MIN_LOCATION_LENGTH) {
    addIssue(issues, "location", "invalid_value", `location must contain at least ${MIN_LOCATION_LENGTH} characters`);
  }

  const venueType = enumValue(input, "venueType", venueTypes, issues, true);
  const requiredPlayers = requiredInteger(
    input,
    "requiredPlayers",
    issues,
    MIN_REQUIRED_PLAYERS,
    MAX_REQUIRED_PLAYERS,
  );
  const fieldPriceRubles = optionalNonNegativeInteger(input, "fieldPriceRubles", issues);
  const dateLabel = optionalLabel(input, "dateLabel", issues);
  const timeLabel = optionalLabel(input, "timeLabel", issues);

  if (issues.length > 0 || date === undefined || time === undefined || timeMode === undefined || timeOptions === undefined || location === undefined || requiredPlayers === undefined || venueType === undefined) {
    return { success: false, issues };
  }

  return {
    success: true,
    value: {
      date,
      time,
      timeMode,
      timeOptions,
      location,
      venueType,
      requiredPlayers,
      ...(fieldPriceRubles === undefined ? {} : { fieldPriceRubles }),
      ...(dateLabel === undefined ? {} : { dateLabel }),
      ...(timeLabel === undefined ? {} : { timeLabel }),
    },
  };
}

export function assertValidMatchDraft(input: unknown): MatchDraft {
  const result = validateMatchDraft(input);
  if (!result.success) throw new DomainValidationError(result.issues);
  return result.value;
}

export function isVenueType(value: unknown): value is VenueType {
  return typeof value === "string" && venueTypes.includes(value as VenueType);
}

export function isVoteOption(value: unknown): value is Vote["option"] {
  return typeof value === "string" && voteOptions.includes(value as Vote["option"]);
}

export function validateMatch(input: unknown): ValidationResult<Match> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ path: "<root>", code: "invalid_type", message: "match must be an object" }],
    };
  }
  const issues: ValidationIssue[] = [];
  const id = isPositiveDomainId(input.id)
    ? input.id
    : (addIssue(issues, "id", "invalid_value", "id must be a positive identifier"), undefined);
  const chatId = isDomainId(input.chatId)
    ? input.chatId
    : (addIssue(issues, "chatId", "invalid_value", "chatId must be an integer or decimal string"), undefined);
  const creatorTelegramUserId = isPositiveDomainId(input.creatorTelegramUserId)
    ? input.creatorTelegramUserId
    : (addIssue(issues, "creatorTelegramUserId", "invalid_value", "creator id must be positive"), undefined);

  const scheduledAt = input.scheduledAt === null
    ? null
    : input.scheduledAt instanceof Date && Number.isFinite(input.scheduledAt.getTime())
      ? new Date(input.scheduledAt.getTime())
      : (addIssue(issues, "scheduledAt", "invalid_value", "scheduledAt must be a valid Date or null"), undefined);
  const location = input.location === null
    ? null
    : typeof input.location === "string"
      ? normalizeText(input.location)
      : (addIssue(issues, "location", "invalid_type", "location must be a string or null"), undefined);
  if (location !== undefined && location !== null && (location.length < MIN_LOCATION_LENGTH || location.length > MAX_LOCATION_LENGTH)) {
    addIssue(issues, "location", "invalid_value", `location must contain ${MIN_LOCATION_LENGTH}-${MAX_LOCATION_LENGTH} characters`);
  }
  const venueType = enumValue(input, "venueType", venueTypes, issues, true);
  const title = input.title === null
    ? null
    : typeof input.title === "string"
      ? normalizeText(input.title)
      : (addIssue(issues, "title", "invalid_type", "title must be a string or null"), undefined);
  const requiredPlayers = requiredInteger(input, "requiredPlayers", issues, MIN_REQUIRED_PLAYERS, MAX_REQUIRED_PLAYERS);
  const status = enumValue(input, "status", matchStatuses, issues) as MatchStatus | undefined;
  const cancellationReason = input.cancellationReason === null
    ? null
    : typeof input.cancellationReason === "string"
      ? normalizeText(input.cancellationReason)
      : (addIssue(issues, "cancellationReason", "invalid_type", "cancellationReason must be a string or null"), undefined);
  const fieldPriceRubles = optionalNonNegativeInteger(input, "fieldPriceRubles", issues);
  const createdAt = input.createdAt === undefined
    ? undefined
    : input.createdAt instanceof Date && Number.isFinite(input.createdAt.getTime())
      ? new Date(input.createdAt.getTime())
      : (addIssue(issues, "createdAt", "invalid_value", "createdAt must be a valid Date"), undefined);
  const updatedAt = input.updatedAt === undefined
    ? undefined
    : input.updatedAt instanceof Date && Number.isFinite(input.updatedAt.getTime())
      ? new Date(input.updatedAt.getTime())
      : (addIssue(issues, "updatedAt", "invalid_value", "updatedAt must be a valid Date"), undefined);

  if (status === "cancelled" && (cancellationReason === undefined || cancellationReason === null || cancellationReason === "")) {
    addIssue(issues, "cancellationReason", "invalid_value", "cancelled matches require a reason");
  }
  if (status !== undefined && status !== "cancelled" && cancellationReason !== null && cancellationReason !== undefined && cancellationReason !== "") {
    addIssue(issues, "cancellationReason", "invalid_value", "only cancelled matches may have a cancellation reason");
  }
  if (issues.length > 0 || id === undefined || chatId === undefined || creatorTelegramUserId === undefined || scheduledAt === undefined || location === undefined || venueType === undefined || title === undefined || requiredPlayers === undefined || status === undefined || cancellationReason === undefined) {
    return { success: false, issues };
  }

  return {
    success: true,
    value: {
      id,
      chatId,
      scheduledAt,
      location,
      venueType,
      fieldPriceRubles: fieldPriceRubles ?? null,
      title,
      requiredPlayers,
      status,
      cancellationReason: cancellationReason === "" ? null : cancellationReason,
      creatorTelegramUserId,
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    },
  };
}

export function assertValidMatch(input: unknown): Match {
  const result = validateMatch(input);
  if (!result.success) throw new DomainValidationError(result.issues);
  return result.value;
}

export function validateVote(input: unknown): ValidationResult<Vote> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ path: "<root>", code: "invalid_type", message: "vote must be an object" }],
    };
  }
  const issues: ValidationIssue[] = [];
  const matchId = isPositiveDomainId(input.matchId)
    ? input.matchId
    : (addIssue(issues, "matchId", "invalid_value", "matchId must be positive"), undefined);
  const telegramUserId = isPositiveDomainId(input.telegramUserId)
    ? input.telegramUserId
    : (addIssue(issues, "telegramUserId", "invalid_value", "telegramUserId must be positive"), undefined);
  const displayNameSnapshot = typeof input.displayNameSnapshot === "string"
    ? normalizeText(input.displayNameSnapshot)
    : (addIssue(issues, "displayNameSnapshot", "invalid_type", "display name must be a string"), undefined);
  const usernameSnapshot = input.usernameSnapshot === null
    ? null
    : input.usernameSnapshot === undefined
      ? null
      : typeof input.usernameSnapshot === "string"
        ? normalizeText(input.usernameSnapshot).replace(/^@+/u, "") || null
        : (addIssue(issues, "usernameSnapshot", "invalid_type", "username must be a string or null"), undefined);
  const option = isVoteOption(input.option)
    ? input.option
    : (addIssue(issues, "option", "invalid_value", `option must be one of: ${voteOptions.join(", ")}`), undefined);
  const availableAfter = input.availableAfter === undefined || input.availableAfter === null
    ? null
    : isLocalTime(input.availableAfter)
      ? input.availableAfter
      : (addIssue(issues, "availableAfter", "invalid_value", "availableAfter must use HH:mm or null"), undefined);
  if (option !== undefined && option !== "going" && availableAfter !== undefined && availableAfter !== null) {
    addIssue(issues, "availableAfter", "invalid_value", "availableAfter is only valid for going votes");
  }
  const updatedAt = input.updatedAt === undefined
    ? undefined
    : input.updatedAt instanceof Date && Number.isFinite(input.updatedAt.getTime())
      ? new Date(input.updatedAt.getTime())
      : (addIssue(issues, "updatedAt", "invalid_value", "updatedAt must be a valid Date"), undefined);
  if (displayNameSnapshot !== undefined && displayNameSnapshot === "") {
    addIssue(issues, "displayNameSnapshot", "invalid_value", "display name must not be empty");
  }
  if (issues.length > 0 || matchId === undefined || telegramUserId === undefined || displayNameSnapshot === undefined || usernameSnapshot === undefined || option === undefined || availableAfter === undefined) {
    return { success: false, issues };
  }
  return {
    success: true,
    value: {
      matchId,
      telegramUserId,
      usernameSnapshot,
      displayNameSnapshot,
      option,
      availableAfter,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    },
  };
}

export function assertValidVote(input: unknown): Vote {
  const result = validateVote(input);
  if (!result.success) throw new DomainValidationError(result.issues);
  return result.value;
}

export function validateExternalParticipant(input: unknown): ValidationResult<ExternalParticipant> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ path: "<root>", code: "invalid_type", message: "external participant must be an object" }],
    };
  }
  const issues: ValidationIssue[] = [];
  const matchId = isPositiveDomainId(input.matchId)
    ? input.matchId
    : (addIssue(issues, "matchId", "invalid_value", "matchId must be positive"), undefined);
  const addedByTelegramUserId = isPositiveDomainId(input.addedByTelegramUserId)
    ? input.addedByTelegramUserId
    : (addIssue(issues, "addedByTelegramUserId", "invalid_value", "added-by user id must be positive"), undefined);
  const quantity = typeof input.quantity === "number" && Number.isSafeInteger(input.quantity) && input.quantity !== 0
    ? input.quantity
    : (addIssue(issues, "quantity", "invalid_value", "quantity must be a non-zero safe integer"), undefined);
  const sourceLabel = input.sourceLabel === null
    ? null
    : input.sourceLabel === undefined
      ? null
      : typeof input.sourceLabel === "string"
        ? normalizeText(input.sourceLabel) || null
        : (addIssue(issues, "sourceLabel", "invalid_type", "sourceLabel must be a string or null"), undefined);
  const displayNameSnapshot = input.displayNameSnapshot === null
    ? null
    : input.displayNameSnapshot === undefined
      ? null
      : typeof input.displayNameSnapshot === "string"
        ? normalizeText(input.displayNameSnapshot) || null
        : (addIssue(issues, "displayNameSnapshot", "invalid_type", "display name must be a string or null"), undefined);
  const sourceUpdateId = input.sourceUpdateId === undefined
    ? undefined
    : isDomainId(input.sourceUpdateId)
      ? input.sourceUpdateId
      : (addIssue(issues, "sourceUpdateId", "invalid_value", "sourceUpdateId must be an identifier"), undefined);
  const id = input.id === undefined
    ? undefined
    : isPositiveDomainId(input.id)
      ? input.id
      : (addIssue(issues, "id", "invalid_value", "id must be positive"), undefined);
  const createdAt = input.createdAt === undefined
    ? undefined
    : input.createdAt instanceof Date && Number.isFinite(input.createdAt.getTime())
      ? new Date(input.createdAt.getTime())
      : (addIssue(issues, "createdAt", "invalid_value", "createdAt must be a valid Date"), undefined);

  if (issues.length > 0 || matchId === undefined || addedByTelegramUserId === undefined || quantity === undefined || sourceLabel === undefined || displayNameSnapshot === undefined || sourceUpdateId === undefined && hasOwn(input, "sourceUpdateId") || id === undefined && hasOwn(input, "id")) {
    return { success: false, issues };
  }
  return {
    success: true,
    value: {
      ...(id === undefined ? {} : { id }),
      matchId,
      addedByTelegramUserId,
      ...(sourceUpdateId === undefined ? {} : { sourceUpdateId }),
      sourceLabel,
      displayNameSnapshot,
      quantity,
      ...(createdAt === undefined ? {} : { createdAt }),
    },
  };
}

export function assertValidExternalParticipant(input: unknown): ExternalParticipant {
  const result = validateExternalParticipant(input);
  if (!result.success) throw new DomainValidationError(result.issues);
  return result.value;
}

export function normalizeTelegramUsername(username: string): string {
  return username.trim().replace(/^@+/u, "").toLocaleLowerCase("en-US");
}

export function isValidTelegramUsername(username: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(normalizeTelegramUsername(username));
}
