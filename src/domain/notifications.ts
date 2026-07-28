export interface ParticipantIdentity {
  telegramUserId: number;
  username?: string | null;
  displayName: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatParticipantMention(identity: ParticipantIdentity): string {
  const username = identity.username?.trim().replace(/^@+/, "");
  if (username !== undefined && username !== "") return `@${username}`;

  const displayName = identity.displayName.trim() || "Игрок";
  return `<a href="tg://user?id=${identity.telegramUserId}">${escapeHtml(displayName)}</a>`;
}

function formatMatchContext(matchId: number, title: string | null | undefined): string {
  const normalizedTitle = title?.trim();
  return normalizedTitle === undefined || normalizedTitle === ""
    ? `#v${matchId}`
    : `#v${matchId} «${normalizedTitle}»`;
}

export function formatThresholdNotification(
  matchId: number,
  title: string | null | undefined,
  threshold: number,
): string {
  return `⚽ ${formatMatchContext(matchId, title)} — Набралось ${threshold} игроков — можно играть!`;
}

export function formatWithdrawalNotification(
  matchId: number,
  title: string | null | undefined,
  identity: ParticipantIdentity,
  goingCount: number,
  threshold: number,
): string {
  return `⚠️ ${formatMatchContext(matchId, title)} — ${formatParticipantMention(identity)} отменил участие. Сейчас: ${goingCount}/${threshold}`;
}

export function formatCancellationNotification(
  matchId: number,
  title: string | null | undefined,
): string {
  return `🚫 ${formatMatchContext(matchId, title)} — матч отменён.`;
}

export function formatConfirmationNotification(
  matchId: number,
  title: string | null | undefined,
): string {
  return `✅ ${formatMatchContext(matchId, title)} — матч состоится.`;
}
