import type { Match, Vote, VoteOption } from "../db/schema.js";

export interface MatchCardData {
  match: Match;
  votes: readonly Vote[];
  externalCount: number;
}

export interface MatchCardView {
  text: string;
  isActive: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function participantHtml(vote: Vote): string {
  const name = escapeHtml(vote.displayNameSnapshot.trim() || "Игрок");
  const username = vote.usernameSnapshot?.trim().replace(/^@+/, "");
  if (username !== undefined && username !== "") {
    return `${name} (@${escapeHtml(username)})`;
  }

  return `<a href="tg://user?id=${vote.telegramUserId}">${name}</a>`;
}

function statusLabel(status: Match["status"]): string {
  switch (status) {
    case "active":
      return "Голосование открыто";
    case "confirmed":
      return "Матч состоится";
    case "completed":
      return "Завершён";
    case "cancelled":
      return "Отменён";
    case "draft":
      return "Черновик";
  }
}

function optionHeading(option: VoteOption): string {
  switch (option) {
    case "going":
      return "✅ Участвуют";
    case "maybe":
      return "❓ Под вопросом";
    case "not_going":
      return "❌ Не смогут";
  }
}

function participantLines(votes: readonly Vote[], option: VoteOption): string[] {
  const selected = votes.filter((vote) => vote.option === option);
  if (selected.length === 0) return ["—"];
  return selected.map(participantHtml);
}

function addParticipantSection(
  lines: string[],
  votes: readonly Vote[],
  option: VoteOption,
  maxLength: number,
): void {
  const names = participantLines(votes, option);
  lines.push(`<b>${optionHeading(option)} (${names[0] === "—" ? 0 : names.length})</b>`);

  let shown = 0;
  for (const name of names) {
    const suffix = `\n${name}`;
    if (lines.join("\n").length + suffix.length > maxLength) break;
    lines.push(name);
    shown += 1;
  }

  if (shown < names.length) {
    lines.push(`<i>… ещё ${names.length - shown}</i>`);
  }
  lines.push("");
}

export function renderMatchCard(data: MatchCardData): MatchCardView {
  const { match, votes, externalCount } = data;
  const goingCount = votes.filter((vote) => vote.option === "going").length + externalCount;
  const title = escapeHtml(match.title?.trim() || `Матч #v${match.id}`);
  const lines = [
    `⚽ <b>#v${match.id}</b>`,
    title,
    "",
    `Статус: <b>${statusLabel(match.status)}</b>`,
    `Подтверждено: <b>${goingCount}/${match.requiredPlayers}</b>`,
    `Внешние игроки: ${externalCount}`,
    "",
  ];

  addParticipantSection(lines, votes, "going", 3900);
  addParticipantSection(lines, votes, "maybe", 3900);
  addParticipantSection(lines, votes, "not_going", 3900);

  return {
    text: lines.join("\n").trim(),
    isActive: match.status === "active" || match.status === "confirmed",
  };
}
