import type { Match, Notification } from "../db/schema.js";
import type { CreateNotificationInput } from "../db/repositories/notifications.js";
import type { ExternalParticipant } from "../db/schema.js";
import { formatThresholdNotification } from "../domain/notifications.js";

const EXTERNAL_PARTICIPANT_COMMAND_PATTERN =
  /^@([A-Za-z0-9_]{5,32})\s+([+-])([1-9]\d*)\s+для\s+#v([1-9]\d*)\s*$/iu;

export interface ExternalParticipantCommand {
  matchId: number;
  quantity: number;
}

export function parseExternalParticipantCommand(
  text: string,
  botUsername: string | undefined,
): ExternalParticipantCommand | undefined {
  const normalizedBotUsername = botUsername?.trim().replace(/^@+/, "").toLowerCase();
  if (normalizedBotUsername === undefined || normalizedBotUsername === "") return undefined;

  const match = EXTERNAL_PARTICIPANT_COMMAND_PATTERN.exec(text.trim());
  const mentionedUsername = match?.[1];
  const sign = match?.[2];
  const quantityText = match?.[3];
  const matchIdText = match?.[4];
  if (
    mentionedUsername === undefined ||
    sign === undefined ||
    quantityText === undefined ||
    matchIdText === undefined ||
    mentionedUsername.toLowerCase() !== normalizedBotUsername
  ) {
    return undefined;
  }

  const quantity = Number(quantityText) * (sign === "-" ? -1 : 1);
  const matchId = Number(matchIdText);
  if (
    !Number.isSafeInteger(quantity) ||
    quantity === 0 ||
    !Number.isSafeInteger(matchId) ||
    matchId < 1
  ) {
    return undefined;
  }
  return { matchId, quantity };
}

export interface ExternalParticipantRepositories {
  matches: {
    findById(matchId: number): Match | undefined;
  };
  votes: {
    countGoing(matchId: number): number;
  };
  externalParticipants: {
    countByMatchId(matchId: number): number;
    add(input: {
      matchId: number;
      addedByTelegramUserId: number;
      sourceUpdateId: number;
      quantity: number;
    }): ExternalParticipant | undefined;
  };
  notifications: {
    listByMatchId(matchId: number): Notification[];
    claim(input: CreateNotificationInput): Notification | undefined;
    delete?(id: number): boolean;
  };
}

export interface ExternalParticipantNotificationSender {
  send(text: string): Promise<void>;
}

export interface AddExternalParticipantInput {
  matchId: number;
  updateId: number;
  addedByTelegramUserId: number;
  quantity: number;
}

export type ExternalParticipantIgnoredReason =
  | "unknown_match"
  | "inactive_match"
  | "duplicate_update"
  | "insufficient_external_players";

export interface ExternalParticipantIgnoredResult {
  status: "ignored";
  reason: ExternalParticipantIgnoredReason;
}

export interface ExternalParticipantAddedResult {
  status: "added";
  matchId: number;
  externalCount: number;
  goingCount: number;
  thresholdCrossed: boolean;
  thresholdNotificationSent: boolean;
}

export type ExternalParticipantResult =
  | ExternalParticipantIgnoredResult
  | ExternalParticipantAddedResult;

function hasReachedThreshold(notifications: readonly Notification[]): boolean {
  return notifications.some((notification) => notification.notificationType === "threshold_reached");
}

function isValidUpdateId(updateId: number): boolean {
  return Number.isSafeInteger(updateId) && updateId >= 0;
}

function isValidQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity !== 0;
}

export interface ExternalParticipantServiceOptions {
  repositories: ExternalParticipantRepositories;
  notifier: ExternalParticipantNotificationSender;
  refreshCard?: (matchId: number) => Promise<void>;
}

export class ExternalParticipantService {
  public constructor(private readonly options: ExternalParticipantServiceOptions) {}

  public async add(input: AddExternalParticipantInput): Promise<ExternalParticipantResult> {
    if (!isValidUpdateId(input.updateId)) {
      throw new Error("Telegram update_id must be a non-negative safe integer");
    }
    if (!isValidQuantity(input.quantity)) {
      throw new Error("External participant quantity must be a positive safe integer");
    }

    const match = this.options.repositories.matches.findById(input.matchId);
    if (match === undefined) {
      return { status: "ignored", reason: "unknown_match" };
    }
    if (match.status !== "active" && match.status !== "confirmed") {
      return { status: "ignored", reason: "inactive_match" };
    }

    const externalCountBefore =
      this.options.repositories.externalParticipants.countByMatchId(match.id);
    const goingCountBefore =
      this.options.repositories.votes.countGoing(match.id) + externalCountBefore;
    if (
      input.quantity < 0 &&
      Math.abs(input.quantity) > externalCountBefore
    ) {
      return { status: "ignored", reason: "insufficient_external_players" };
    }
    const thresholdWasReached = hasReachedThreshold(
      this.options.repositories.notifications.listByMatchId(match.id),
    );
    const participant = this.options.repositories.externalParticipants.add({
      matchId: match.id,
      addedByTelegramUserId: input.addedByTelegramUserId,
      sourceUpdateId: input.updateId,
      quantity: input.quantity,
    });

    if (participant === undefined) {
      return { status: "ignored", reason: "duplicate_update" };
    }

    const goingCountAfter = goingCountBefore + input.quantity;
    const thresholdCrossed =
      goingCountBefore < match.requiredPlayers && goingCountAfter >= match.requiredPlayers;

    let thresholdNotificationSent = false;
    if (!thresholdWasReached && goingCountAfter >= match.requiredPlayers) {
      const claim = this.options.repositories.notifications.claim({
        matchId: match.id,
        notificationType: "threshold_reached",
        transitionKey: `threshold:${match.id}:${match.requiredPlayers}`,
      });
      if (claim !== undefined) {
        try {
          await this.options.notifier.send(
            formatThresholdNotification(match.id, match.title, match.requiredPlayers),
          );
        } catch (error) {
          this.options.repositories.notifications.delete?.(claim.id);
          console.error(
            `External-player notification failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (this.options.repositories.notifications.listByMatchId(match.id).some(
          (notification) =>
            notification.notificationType === "threshold_reached" &&
            notification.transitionKey === `threshold:${match.id}:${match.requiredPlayers}`,
        )) {
          thresholdNotificationSent = true;
        }
      }
    }

    await this.options.refreshCard?.(match.id);

    return {
      status: "added",
      matchId: match.id,
      externalCount: externalCountBefore + input.quantity,
      goingCount: goingCountAfter,
      thresholdCrossed,
      thresholdNotificationSent,
    };
  }
}

export function createExternalParticipantService(
  options: ExternalParticipantServiceOptions,
): ExternalParticipantService {
  return new ExternalParticipantService(options);
}
