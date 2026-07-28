import type { Match, NotificationType, VoteOption } from "../db/schema.js";
import { evaluateVoteTransition } from "../domain/votes.js";
import {
  formatConfirmationNotification,
  formatCancellationNotification,
  formatThresholdLostNotification,
  formatThresholdNotification,
} from "../domain/notifications.js";
import type {
  ApplyVoteResult,
  ChangeMatchStatusResult,
} from "../db/repositories/match-actions.js";
import {
  type MatchAction,
  type MatchCallbackUpdate,
  type MatchVoteOption,
  parseMatchAction,
} from "./match-card.js";

export interface MatchActionRepositories {
  matchActions: {
    applyVote(input: {
      updateId: number;
      matchId: number;
      telegramUserId: number;
      usernameSnapshot: string | null;
      displayNameSnapshot: string;
      option: VoteOption;
    }): ApplyVoteResult;
    changeStatus(input: {
      updateId: number;
      matchId: number;
      telegramUserId: number;
      status: "confirmed" | "completed" | "cancelled";
      cancellationReason?: string | null;
      allowedCurrentStatuses: readonly Match["status"][];
    }): ChangeMatchStatusResult;
  };
  matches: {
    findById(matchId: number): Match | undefined;
  };
  matchMessages: {
    findByChatAndMessageId(
      chatId: number,
      messageId: number,
      kind?: "public_card" | "admin_panel",
    ): { matchId: number; chatId: number; messageId: number; kind: "public_card" | "admin_panel" } | undefined;
  };
  notifications: {
    claim(input: {
      matchId: number;
      notificationType: NotificationType;
      transitionKey: string;
    }): { id: number } | undefined;
    delete(id: number): boolean;
  };
}

export interface MatchActionNotifier {
  send(text: string): Promise<void>;
}

export interface MatchActionOptions {
  repositories: MatchActionRepositories;
  notifier: MatchActionNotifier;
  refreshCard: (matchId: number) => Promise<void>;
  showCancellationPrompt?: (match: Match) => Promise<void>;
  isAdmin: (telegramUserId: number) => boolean | Promise<boolean>;
}

export type MatchActionResult =
  | { status: "invalid_action"; answer: string }
  | { status: "ignored"; answer: string }
  | { status: "processed"; answer?: string; action: MatchAction };

function voteOption(option: MatchVoteOption): VoteOption {
  return option;
}

function alreadyInactive(match: Match): string {
  return match.status === "cancelled"
    ? "Матч отменён и больше не принимает изменения"
    : `Матч уже ${match.status === "confirmed" ? "подтверждён" : match.status === "completed" ? "завершён" : "недоступен"}`;
}

function isCancellationReasonAction(
  action: MatchAction["kind"],
): action is "cancel_insufficient_players" | "cancel_bad_weather" {
  return action === "cancel_insufficient_players" || action === "cancel_bad_weather";
}

function cancellationReasonForAction(
  action: "cancel_insufficient_players" | "cancel_bad_weather",
): string {
  return action === "cancel_insufficient_players"
    ? "Недостаточно игроков"
    : "Плохая погода";
}

export class MatchActionService {
  public constructor(private readonly options: MatchActionOptions) {}

  public async process(update: MatchCallbackUpdate): Promise<MatchActionResult> {
    const messageKind = update.action.kind === "vote" ? "public_card" : "admin_panel";
    const message = this.options.repositories.matchMessages.findByChatAndMessageId(
      update.chatId,
      update.messageId,
      messageKind,
    );
    if (message === undefined || message.matchId !== update.action.matchId) {
      return { status: "ignored", answer: "Это сообщение матча больше не актуально" };
    }

    const match = this.options.repositories.matches.findById(update.action.matchId);
    if (match === undefined) return { status: "ignored", answer: "Матч не найден" };

    if (update.action.kind === "vote") {
      return this.processVote(
        update as MatchCallbackUpdate & { action: Extract<MatchAction, { kind: "vote" }> },
        match,
      );
    }

    return this.processAdminAction(
      update as MatchCallbackUpdate & { action: Exclude<MatchAction, { kind: "vote" }> },
      match,
    );
  }

  public static parseCallbackData(data: string): MatchAction | undefined {
    return parseMatchAction(data);
  }

  private async processVote(
    update: MatchCallbackUpdate & { action: Extract<MatchAction, { kind: "vote" }> },
    match: Match,
  ): Promise<MatchActionResult> {
    if (match.status !== "active" && match.status !== "confirmed") {
      return { status: "ignored", answer: alreadyInactive(match) };
    }

    const result = this.options.repositories.matchActions.applyVote({
      updateId: update.updateId,
      matchId: match.id,
      telegramUserId: update.telegramUserId,
      usernameSnapshot: update.username ?? null,
      displayNameSnapshot: update.displayName,
      option: voteOption(update.action.option),
    });

    if (result.status === "duplicate") {
      return { status: "ignored", answer: "Это действие уже обработано" };
    }
    if (result.status === "missing_match") {
      return { status: "ignored", answer: "Матч не найден" };
    }
    if (result.status === "inactive_match") {
      return { status: "ignored", answer: alreadyInactive(result.match) };
    }

    const transition = evaluateVoteTransition({
      previousOption: result.previousVote?.option ?? null,
      nextOption: update.action.option,
      goingCountBefore: result.goingCountBefore,
      threshold: match.requiredPlayers,
      eventKey: String(update.updateId),
    });

    await this.sendClaimedNotification(
      transition.thresholdReachedNotificationKey === undefined
        ? undefined
        : {
            matchId: match.id,
            notificationType: "threshold_reached",
            transitionKey: transition.thresholdReachedNotificationKey,
            text: formatThresholdNotification(
              match.id,
              match.title,
              result.goingCountAfter,
              match.requiredPlayers,
            ),
          },
    );
    await this.sendClaimedNotification(
      transition.thresholdLostNotificationKey === undefined
        ? undefined
        : {
            matchId: match.id,
            notificationType: "threshold_lost",
            transitionKey: transition.thresholdLostNotificationKey,
            text: formatThresholdLostNotification(
              match.id,
              match.title,
              transition.goingCountAfter,
              match.requiredPlayers,
            ),
          },
    );

    await this.options.refreshCard(match.id);
    return {
      status: "processed",
      action: update.action,
    };
  }

  private async processAdminAction(
    update: MatchCallbackUpdate & { action: Exclude<MatchAction, { kind: "vote" }> },
    match: Match,
  ): Promise<MatchActionResult> {
    if (update.chatId !== update.telegramUserId || match.creatorTelegramUserId !== update.telegramUserId) {
      return { status: "ignored", answer: "Управлять матчем может только его создатель" };
    }
    if (!(await this.options.isAdmin(update.telegramUserId))) {
      return { status: "ignored", answer: "Недостаточно прав" };
    }

    if (update.action.kind === "cancel") {
      if (match.status !== "active" && match.status !== "confirmed") {
        return { status: "ignored", answer: alreadyInactive(match) };
      }
      await this.options.showCancellationPrompt?.(match);
      return { status: "processed", action: update.action };
    }
    if (update.action.kind === "cancel_back") {
      await this.options.refreshCard(match.id);
      return { status: "processed", action: update.action };
    }

    if (isCancellationReasonAction(update.action.kind) && match.status === "cancelled") {
      await this.sendClaimedNotification({
        matchId: match.id,
        notificationType: "match_cancelled",
        transitionKey: "status:cancelled",
        text: formatCancellationNotification(match.id, match.title, match.cancellationReason),
      });
      await this.options.refreshCard(match.id);
      return { status: "ignored", answer: "Матч уже отменён" };
    }
    const status = isCancellationReasonAction(update.action.kind)
      ? "cancelled"
      : update.action.kind === "confirm"
        ? "confirmed"
        : "completed";
    const allowedCurrentStatuses = isCancellationReasonAction(update.action.kind)
      ? (["active", "confirmed"] as const)
      : update.action.kind === "confirm"
        ? (["active"] as const)
        : (["confirmed"] as const);
    if (!allowedCurrentStatuses.some((status) => status === match.status)) {
      return {
        status: "ignored",
        answer: update.action.kind === "complete" && match.status === "active"
          ? "Сначала подтвердите, что матч состоится"
          : alreadyInactive(match),
      };
    }
    const cancellationReason = isCancellationReasonAction(update.action.kind)
      ? cancellationReasonForAction(update.action.kind)
      : undefined;
    const result = this.options.repositories.matchActions.changeStatus({
      updateId: update.updateId,
      matchId: match.id,
      telegramUserId: update.telegramUserId,
      status,
      ...(cancellationReason === undefined
        ? {}
        : { cancellationReason }),
      allowedCurrentStatuses,
    });
    if (result.status === "duplicate") return { status: "ignored", answer: "Это действие уже обработано" };
    if (result.status === "missing_match") return { status: "ignored", answer: "Матч не найден" };
    if (result.status === "inactive_match") {
      return { status: "ignored", answer: alreadyInactive(result.match) };
    }

    if (status === "confirmed") {
      await this.sendClaimedNotification({
        matchId: match.id,
        notificationType: "match_confirmed",
        transitionKey: "status:confirmed",
        text: formatConfirmationNotification(match.id, match.title),
      });
    } else if (status === "cancelled") {
      await this.sendClaimedNotification({
        matchId: match.id,
        notificationType: "match_cancelled",
        transitionKey: "status:cancelled",
        text: formatCancellationNotification(
          match.id,
          match.title,
          result.match.cancellationReason,
        ),
      });
    }
    await this.options.refreshCard(match.id);

    return {
      status: "processed",
      answer: status === "confirmed"
        ? "Матч подтверждён"
        : status === "cancelled"
          ? "Матч отменён"
          : "Матч завершён",
      action: update.action,
    };
  }

  private async sendClaimedNotification(input: {
    matchId: number;
    notificationType: NotificationType;
    transitionKey: string;
    text: string;
  } | undefined): Promise<void> {
    if (input === undefined) return;
    const claim = this.options.repositories.notifications.claim(input);
    if (claim === undefined) return;

    try {
      await this.options.notifier.send(input.text);
    } catch (error) {
      this.options.repositories.notifications.delete(claim.id);
      console.error(
        `Match notification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export function createMatchActionService(options: MatchActionOptions): MatchActionService {
  return new MatchActionService(options);
}
