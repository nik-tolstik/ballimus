import type { ExternalParticipant, Match, NotificationType } from "../db/schema.js";
import {
  formatThresholdLostNotification,
  formatThresholdNotification,
} from "../domain/notifications.js";
import { evaluateThresholdTransition } from "../domain/votes.js";

const EXTERNAL_PARTICIPANT_COMMAND_PATTERN =
  /^@([A-Za-z0-9_]{5,32})(?:\s+от\s+(.+?))?\s+([+-])([1-9]\d*)(?:\s+игрок(?:а|ов)?)?\s+для\s+#v([1-9]\d*)\s*$/iu;
const MAX_SOURCE_LABEL_LENGTH = 80;

export interface ExternalParticipantCommand {
  matchId: number;
  quantity: number;
  sourceLabel: string | null;
}

function normalizeSourceLabel(value: string | undefined): string | null | undefined {
  if (value === undefined) return null;

  const sourceLabel = value.trim().replace(/\s+/gu, " ");
  if (sourceLabel === "" || sourceLabel.length > MAX_SOURCE_LABEL_LENGTH) return undefined;

  return sourceLabel;
}

export function parseExternalParticipantCommand(
  text: string,
  botUsername: string | undefined,
): ExternalParticipantCommand | undefined {
  const normalizedBotUsername = botUsername?.trim().replace(/^@+/, "").toLowerCase();
  if (normalizedBotUsername === undefined || normalizedBotUsername === "") return undefined;

  const match = EXTERNAL_PARTICIPANT_COMMAND_PATTERN.exec(text.trim());
  const mentionedUsername = match?.[1];
  const sourceLabel = normalizeSourceLabel(match?.[2]);
  const sign = match?.[3];
  const quantityText = match?.[4];
  const matchIdText = match?.[5];
  if (
    mentionedUsername === undefined ||
    sourceLabel === undefined ||
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
  return { matchId, quantity, sourceLabel };
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
    countByMatchIdAndSourceLabel(matchId: number, sourceLabel: string): number;
    countByMatchIdWithoutSourceLabel(matchId: number): number;
    add(input: {
      matchId: number;
      addedByTelegramUserId: number;
      sourceUpdateId: number;
      quantity: number;
      sourceLabel: string | null;
    }): ExternalParticipant | undefined;
  };
  notifications: {
    claim(input: {
      matchId: number;
      notificationType: NotificationType;
      transitionKey: string;
    }): { id: number } | undefined;
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
  sourceLabel?: string | null;
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
  sourceLabel: string | null;
  externalCount: number;
  goingCount: number;
  thresholdReached: boolean;
  thresholdLost: boolean;
  thresholdReachedNotificationSent: boolean;
  thresholdLostNotificationSent: boolean;
  /** @deprecated Use thresholdReached. */
  thresholdCrossed: boolean;
  /** @deprecated Use thresholdReachedNotificationSent. */
  thresholdNotificationSent: boolean;
}

export type ExternalParticipantResult =
  | ExternalParticipantIgnoredResult
  | ExternalParticipantAddedResult;

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
      throw new Error("External participant quantity must be a non-zero safe integer");
    }

    const match = this.options.repositories.matches.findById(input.matchId);
    if (match === undefined) {
      return { status: "ignored", reason: "unknown_match" };
    }
    if (match.status !== "active" && match.status !== "confirmed") {
      return { status: "ignored", reason: "inactive_match" };
    }

    const sourceLabel = input.sourceLabel ?? null;
    const externalCountBefore =
      this.options.repositories.externalParticipants.countByMatchId(match.id);
    const goingCountBefore =
      this.options.repositories.votes.countGoing(match.id) + externalCountBefore;
    const sourceCountBefore = sourceLabel === null
      ? this.options.repositories.externalParticipants.countByMatchIdWithoutSourceLabel(match.id)
      : this.options.repositories.externalParticipants.countByMatchIdAndSourceLabel(
        match.id,
        sourceLabel,
      );
    if (input.quantity < 0 && Math.abs(input.quantity) > sourceCountBefore) {
      return { status: "ignored", reason: "insufficient_external_players" };
    }
    const participant = this.options.repositories.externalParticipants.add({
      matchId: match.id,
      addedByTelegramUserId: input.addedByTelegramUserId,
      sourceUpdateId: input.updateId,
      quantity: input.quantity,
      sourceLabel,
    });

    if (participant === undefined) {
      return { status: "ignored", reason: "duplicate_update" };
    }

    const goingCountAfter = goingCountBefore + input.quantity;
    const transition = evaluateThresholdTransition({
      countBefore: goingCountBefore,
      countAfter: goingCountAfter,
      threshold: match.requiredPlayers,
      eventKey: String(input.updateId),
    });
    const thresholdReachedNotificationSent = await this.sendClaimedNotification(
      transition.thresholdReachedNotificationKey === undefined
        ? undefined
        : {
            matchId: match.id,
            notificationType: "threshold_reached",
            transitionKey: transition.thresholdReachedNotificationKey,
            text: formatThresholdNotification(
              match.id,
              match.title,
              goingCountAfter,
              match.requiredPlayers,
            ),
          },
    );
    const thresholdLostNotificationSent = await this.sendClaimedNotification(
      transition.thresholdLostNotificationKey === undefined
        ? undefined
        : {
            matchId: match.id,
            notificationType: "threshold_lost",
            transitionKey: transition.thresholdLostNotificationKey,
            text: formatThresholdLostNotification(
              match.id,
              match.title,
              goingCountAfter,
              match.requiredPlayers,
            ),
          },
    );

    await this.options.refreshCard?.(match.id);

    return {
      status: "added",
      matchId: match.id,
      sourceLabel,
      externalCount: externalCountBefore + input.quantity,
      goingCount: goingCountAfter,
      thresholdReached: transition.thresholdReached,
      thresholdLost: transition.thresholdLost,
      thresholdReachedNotificationSent,
      thresholdLostNotificationSent,
      thresholdCrossed: transition.thresholdReached,
      thresholdNotificationSent: thresholdReachedNotificationSent,
    };
  }

  private async sendClaimedNotification(input: {
    matchId: number;
    notificationType: NotificationType;
    transitionKey: string;
    text: string;
  } | undefined): Promise<boolean> {
    if (input === undefined) return false;

    const claim = this.options.repositories.notifications.claim(input);
    if (claim === undefined) return false;

    try {
      await this.options.notifier.send(input.text);
      return true;
    } catch (error) {
      this.options.repositories.notifications.delete?.(claim.id);
      console.error(
        `External-player notification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

export function createExternalParticipantService(
  options: ExternalParticipantServiceOptions,
): ExternalParticipantService {
  return new ExternalParticipantService(options);
}
