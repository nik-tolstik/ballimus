function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatMatchContext(matchId: number, title: string | null | undefined): string {
  const normalizedTitle = title?.trim();
  return normalizedTitle === undefined || normalizedTitle === ""
    ? `#v${matchId}`
    : `#v${matchId} «${escapeHtml(normalizedTitle)}»`;
}

export function formatThresholdNotification(
  matchId: number,
  title: string | null | undefined,
  goingCount: number,
  threshold: number,
): string {
  return `${formatMatchContext(matchId, title)} — Набралось ${goingCount}/${threshold} игроков — можно играть!`;
}

export function formatThresholdLostNotification(
  matchId: number,
  title: string | null | undefined,
  goingCount: number,
  threshold: number,
): string {
  return `${formatMatchContext(matchId, title)} — Игроков снова меньше минимума. Сейчас: ${goingCount}/${threshold}`;
}

export function formatCancellationNotification(
  matchId: number,
  title: string | null | undefined,
  reason: string | null | undefined,
): string {
  const normalizedReason = reason?.trim();
  const reasonText = normalizedReason === undefined || normalizedReason === ""
    ? ""
    : ` Причина: ${escapeHtml(normalizedReason)}.`;
  return `${formatMatchContext(matchId, title)} — матч отменён.${reasonText}`;
}

export function formatConfirmationNotification(
  matchId: number,
  title: string | null | undefined,
): string {
  return `${formatMatchContext(matchId, title)} — матч состоится.`;
}
