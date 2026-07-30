import {
  deriveMatchPlanningStage,
  isVoteEligibleForMatch,
  lifecycleNotificationTransition,
  thresholdLostNotificationTransition,
  thresholdReachedNotificationTransition,
  type FormattedNotificationTransition,
} from "@football/domain";
import type {
  InsertOutboxEventInput,
  Match,
  RosterCounts,
  TransactionRepositories,
} from "@football/db";

interface ThresholdMutation {
  readonly match: Match;
  readonly countsAfter: RosterCounts;
  readonly thresholdReached: boolean;
  readonly thresholdLost: boolean;
}

function notificationEvent(
  transition: FormattedNotificationTransition,
  notificationId: bigint,
  match: Match,
  telegramTopicId: bigint,
): InsertOutboxEventInput {
  return {
    eventType: "send_notification",
    deduplicationKey: `notification:${match.id.toString(10)}:${transition.notificationType}:${transition.transitionKey}`,
    notificationId,
    telegramChatId: match.telegramChatId,
    telegramTopicId,
    payload: {
      text: transition.text,
      notificationType: transition.notificationType,
      transitionKey: transition.transitionKey,
    },
  };
}

/** Claims a threshold transition and returns its durable Telegram outbox event. */
export async function claimThresholdNotificationEvent(
  repositories: TransactionRepositories,
  result: ThresholdMutation,
  eventKey: string,
  telegramTopicId: bigint,
): Promise<InsertOutboxEventInput | undefined> {
  const transition = result.thresholdReached
    ? thresholdReachedNotificationTransition({
      matchId: result.match.id,
      title: result.match.title,
      scheduleDate: result.match.scheduleDate,
      location: result.match.location,
      goingCount: result.countsAfter.goingCount,
      threshold: result.match.requiredPlayers,
      eventKey,
      requiresFinalDetails: deriveMatchPlanningStage(result.match, result.countsAfter.goingCount) === "finalizing_details",
    })
    : result.thresholdLost
      ? thresholdLostNotificationTransition({
        matchId: result.match.id,
        title: result.match.title,
        goingCount: result.countsAfter.goingCount,
        threshold: result.match.requiredPlayers,
        eventKey,
      })
      : undefined;
  if (transition === undefined) return undefined;

  const claim = await repositories.notifications.claimInTransaction({
    matchId: result.match.id,
    notificationType: transition.notificationType,
    transitionKey: transition.transitionKey,
    payload: { text: transition.text },
  });
  return notificationEvent(transition, claim.notification.id, result.match, telegramTopicId);
}

/** Claims a lifecycle transition and returns its durable Telegram outbox event. */
export async function claimLifecycleNotificationEvent(
  repositories: TransactionRepositories,
  match: Match,
  telegramTopicId: bigint,
  timezone: string,
): Promise<InsertOutboxEventInput | undefined> {
  if (match.status !== "confirmed" && match.status !== "cancelled") return undefined;
  const transition = match.status === "confirmed"
    ? await Promise.all([
      repositories.votes.listByMatchId(match.id),
      repositories.votes.rosterCounts(match.id),
    ]).then(([votes, counts]) => lifecycleNotificationTransition({
      matchId: match.id,
      status: "confirmed",
      scheduledAt: match.scheduledAt,
      location: match.location,
      fieldPriceRubles: match.fieldPriceRubles,
      goingCount: counts.goingCount,
      votes: votes.filter((vote) => isVoteEligibleForMatch(match, vote)),
      timezone,
    }))
    : lifecycleNotificationTransition({
      matchId: match.id,
      status: "cancelled",
      cancellationReason: match.cancellationReason,
    });
  const claim = await repositories.notifications.claimInTransaction({
    matchId: match.id,
    notificationType: transition.notificationType,
    transitionKey: transition.transitionKey,
    payload: { text: transition.text },
  });
  return notificationEvent(transition, claim.notification.id, match, telegramTopicId);
}
