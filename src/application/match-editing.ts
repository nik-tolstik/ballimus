import { DateTime } from "luxon";

import type {
  UpdateMatchDetailsInput,
  UpdateMatchDetailsResult,
} from "../db/repositories/match-actions.js";
import type { Match, MatchStatus } from "../db/schema.js";
import type { MatchDraft } from "../parser/match-parser.js";
import { formatMatchTitle, matchScheduledAt } from "./match-creation.js";

export interface MatchEditCommand {
  matchId: number;
  matchCommand: string;
}

export interface MatchEditInput {
  updateId: number;
  chatId: number;
  matchId: number;
  editorTelegramUserId: number;
  timezone: string;
  draft: MatchDraft;
}

export type MatchEditResult =
  | { status: "updated"; match: Match }
  | { status: "ignored"; answer: string }
  | { status: "duplicate"; answer: string };

export interface MatchEditingRepositories {
  matches: {
    findById(matchId: number): Match | undefined;
  };
  matchActions: {
    updateDetails(input: UpdateMatchDetailsInput): UpdateMatchDetailsResult;
  };
}

export interface MatchEditingOptions {
  repositories: MatchEditingRepositories;
  authorizeCreator: (telegramUserId: number, chatId: number) => boolean | Promise<boolean>;
}

const EDIT_MATCH_HEADER = /^\s*\/editmatch(?:@[A-Za-z0-9_]{5,32})?\s+#v([1-9]\d*)[ \t]*(?:\n|$)/iu;

function terminalMatchAnswer(status: MatchStatus): string {
  return status === "cancelled"
    ? "Матч отменён и больше не редактируется"
    : status === "completed"
      ? "Матч завершён и больше не редактируется"
      : "Этот матч пока нельзя редактировать";
}

function venueTypeLabel(match: Match): string {
  return match.venueType === "outdoor"
    ? "на улице"
    : match.venueType === "indoor"
      ? "в здании"
      : "укажите";
}

function storedDateLabel(match: Match): string | undefined {
  const title = match.title?.trim();
  if (title === undefined || title === "") return undefined;

  const label = /^(?:Сегодня|Завтра|Послезавтра|\d{1,2}\.\d{1,2}(?:\.\d{4})?|\d{1,2}\s+[А-Яа-яЁё]+(?:\s+\d{4})?)/u.exec(title)?.[0];
  return label?.trim();
}

function editScheduleValues(match: Match, timezone: string): { date: string; time: string } {
  if (match.scheduledAt === null) {
    return { date: storedDateLabel(match) ?? "укажите", time: "укажите" };
  }

  const local = DateTime.fromJSDate(match.scheduledAt, { zone: timezone });
  if (!local.isValid) return { date: "укажите", time: "укажите" };
  return { date: local.toFormat("dd.LL.yyyy"), time: local.toFormat("HH:mm") };
}

/** Parses a full /editmatch form by adapting its body to the existing /match parser. */
export function parseMatchEditCommand(text: string): MatchEditCommand | undefined {
  const normalized = text.normalize("NFC").replace(/\r\n?/gu, "\n");
  const header = EDIT_MATCH_HEADER.exec(normalized);
  if (header?.[1] === undefined) return undefined;

  const matchId = Number(header[1]);
  if (!Number.isSafeInteger(matchId) || matchId < 1) return undefined;

  const body = normalized.slice(header[0].length).trim();
  if (body === "") return undefined;
  return { matchId, matchCommand: `/match\n${body}` };
}

/** Formats the copyable full-replacement template sent from the private admin panel. */
export function matchEditPromptText(match: Match, timezone: string): string {
  const schedule = editScheduleValues(match, timezone);
  const price = match.fieldPriceRubles;
  return [
    `Редактирование матча #v${match.id}`,
    "Скопируйте шаблон, внесите изменения и отправьте его боту одним сообщением:",
    "",
    `/editmatch #v${match.id}`,
    `Дата: ${schedule.date}`,
    `Время: ${schedule.time}`,
    `Место: ${match.location?.trim() ?? ""}`,
    `Формат: ${venueTypeLabel(match)}`,
    `Нужно игроков: ${match.requiredPlayers}`,
    ...(price === null || price === undefined ? [] : [`Цена поля: ${price} рублей`]),
  ].join("\n");
}

export class MatchEditingService {
  public constructor(private readonly options: MatchEditingOptions) {}

  public async edit(input: MatchEditInput): Promise<MatchEditResult> {
    const match = this.options.repositories.matches.findById(input.matchId);
    if (match === undefined || match.chatId !== input.chatId) {
      return { status: "ignored", answer: `Матч #v${input.matchId} не найден.` };
    }
    if (match.creatorTelegramUserId !== input.editorTelegramUserId) {
      return { status: "ignored", answer: "Редактировать матч может только его создатель" };
    }
    if (!(await this.options.authorizeCreator(input.editorTelegramUserId, match.chatId))) {
      return { status: "ignored", answer: "Недостаточно прав" };
    }
    if (match.status !== "active" && match.status !== "confirmed") {
      return { status: "ignored", answer: terminalMatchAnswer(match.status) };
    }

    const result = this.options.repositories.matchActions.updateDetails({
      updateId: input.updateId,
      matchId: match.id,
      telegramUserId: input.editorTelegramUserId,
      scheduledAt: matchScheduledAt(input.draft, input.timezone),
      location: input.draft.location,
      venueType: input.draft.venueType ?? null,
      fieldPriceRubles: input.draft.fieldPriceRubles ?? null,
      title: formatMatchTitle(input.draft),
      requiredPlayers: input.draft.requiredPlayers,
      allowedCurrentStatuses: ["active", "confirmed"],
    });
    if (result.status === "updated") return result;
    if (result.status === "duplicate") {
      return { status: "duplicate", answer: "Это редактирование уже обработано" };
    }
    if (result.status === "missing_match") {
      return { status: "ignored", answer: `Матч #v${input.matchId} не найден.` };
    }
    return { status: "ignored", answer: terminalMatchAnswer(result.match.status) };
  }
}

export function createMatchEditingService(options: MatchEditingOptions): MatchEditingService {
  return new MatchEditingService(options);
}
