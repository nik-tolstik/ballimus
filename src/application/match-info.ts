import { DateTime } from "luxon";

import type { Match, MatchStatus, Vote } from "../db/schema.js";

export interface MatchInfoRepositories {
  matches: {
    findById(matchId: number): Match | undefined;
    listByStatus(chatId: number, status: MatchStatus): Match[];
  };
  votes: {
    listByMatchId(matchId: number): Vote[];
  };
  externalParticipants: {
    countByMatchId(matchId: number): number;
  };
}

export interface MatchInfoInput {
  chatId: number;
  matchId?: number;
}

export interface MatchInfoFoundResult {
  status: "found";
  match: Match;
  votes: Vote[];
  externalCount: number;
}

export interface MatchInfoNotFoundResult {
  status: "not_found";
  reason: "match_not_found" | "no_active_match" | "multiple_active_matches";
  activeMatchIds?: number[];
}

export type MatchInfoResult = MatchInfoFoundResult | MatchInfoNotFoundResult;

export class MatchInfoService {
  public constructor(private readonly repositories: MatchInfoRepositories) {}

  public get(input: MatchInfoInput): MatchInfoResult {
    let match: Match | undefined;

    if (input.matchId !== undefined) {
      match = this.repositories.matches.findById(input.matchId);
      if (match === undefined || match.chatId !== input.chatId) {
        return { status: "not_found", reason: "match_not_found" };
      }
    } else {
      const openMatches = [
        ...this.repositories.matches.listByStatus(input.chatId, "active"),
        ...this.repositories.matches.listByStatus(input.chatId, "confirmed"),
      ];
      if (openMatches.length === 0) {
        return { status: "not_found", reason: "no_active_match" };
      }
      if (openMatches.length > 1) {
        return {
          status: "not_found",
          reason: "multiple_active_matches",
          activeMatchIds: openMatches.map((openMatch) => openMatch.id),
        };
      }
      match = openMatches[0];
    }

    if (match === undefined) {
      return { status: "not_found", reason: "match_not_found" };
    }

    return {
      status: "found",
      match,
      votes: this.repositories.votes.listByMatchId(match.id),
      externalCount: this.repositories.externalParticipants.countByMatchId(match.id),
    };
  }
}

export function createMatchInfoService(
  repositories: MatchInfoRepositories,
): MatchInfoService {
  return new MatchInfoService(repositories);
}

export function parseMatchInfoMatchId(text: string): number | null | undefined {
  const command = /^\/matchinfo(?:@[A-Za-z0-9_]{5,32})?(?:\s+(.+?))?\s*$/iu.exec(text.trim());
  const argument = command?.[1]?.trim();
  if (argument === undefined || argument === "") return undefined;

  const match = /^#?v?([1-9]\d*)$/iu.exec(argument);
  const matchId = match?.[1] === undefined ? NaN : Number(match[1]);
  return Number.isSafeInteger(matchId) ? matchId : null;
}

function voteOptionLabel(option: Vote["option"]): string {
  switch (option) {
    case "going":
      return "Буду";
    case "not_going":
      return "Не смогу";
    case "maybe":
      return "Под вопросом";
  }
}

function participantLabel(vote: Vote): string {
  const username = vote.usernameSnapshot?.trim().replace(/^@+/, "");
  const name = vote.displayNameSnapshot.trim() || "Игрок";
  if (username !== undefined && username !== "") return `${name} (@${username})`;
  return `${name} (ID ${vote.telegramUserId})`;
}

function matchStatusLabel(status: Match["status"]): string {
  switch (status) {
    case "active":
      return "Голосование открыто";
    case "confirmed":
      return "Матч состоится";
    case "draft":
      return "Черновик";
    case "completed":
      return "Завершён";
    case "cancelled":
      return "Отменён";
  }
}

function formatParticipants(votes: readonly Vote[], option: Vote["option"]): string[] {
  const participants = votes
    .filter((vote) => vote.option === option)
    .map((vote) => participantLabel(vote));
  return participants.length === 0 ? ["—"] : participants.map((participant) => `- ${participant}`);
}

export function formatMatchInfo(
  result: MatchInfoFoundResult,
  timezone: string,
): string {
  const { match, votes, externalCount } = result;
  const fieldPriceRubles = match.fieldPriceRubles ?? null;
  const scheduledAt =
    match.scheduledAt === null
      ? "время уточняется"
      : DateTime.fromJSDate(match.scheduledAt, { zone: timezone }).toFormat("dd.LL.yyyy HH:mm");
  const goingCount = votes.filter((vote) => vote.option === "going").length + externalCount;
  const lines = [
    `⚽ Матч #v${match.id}`,
    `Дата: ${scheduledAt}`,
    `Место: ${match.location ?? "место уточняется"}`,
    `Цена поля: ${fieldPriceRubles === null ? "не указана" : `${fieldPriceRubles} рублей`}`,
    `Статус: ${matchStatusLabel(match.status)}`,
    `Участники: ${goingCount}/${match.requiredPlayers}`,
    `Дополнительные игроки: ${externalCount}`,
    "",
  ];

  for (const option of ["going", "not_going", "maybe"] as const) {
    const count = votes.filter((vote) => vote.option === option).length;
    lines.push(`${voteOptionLabel(option)} (${count}):`);
    lines.push(...formatParticipants(votes, option));
  }

  return lines.join("\n");
}
