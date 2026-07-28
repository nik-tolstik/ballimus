import type { Match, NotificationType, Vote, VoteOption } from "../db/schema.js";
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
  RemoveVoteInput,
  RemoveVoteResult as RemoveVoteRepositoryResult,
} from "../db/repositories/match-actions.js";
import type { RemoveVoteTarget } from "./vote-removal.js";
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
    removeVote(input: RemoveVoteInput): RemoveVoteRepositoryResult;
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
  votes: {
    find(matchId: number, telegramUserId: number): Vote | undefined;
    findByMatchIdAndUsername(matchId: number, username: string): Vote[];
  };
  processedUpdates: {
    findByUpdateId(updateId: number): { matchId: number } | undefined;
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
  showEditPrompt?: (match: Match, userId: number) => Promise<void>;
  isAdmin: (telegramUserId: number) => boolean | Promise<boolean>;
}

export type MatchActionResult =
  | { status: "invalid_action"; answer: string }
  | { status: "ignored"; answer: string }
  | { status: "processed"; answer?: string; action: MatchAction };

export type VoteRemovalResult =
  | { status: "removed"; answer: string; vote: Vote }
  | { status: "ignored"; answer: string };

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

  public async removeVote(input: {
    updateId: number;
    chatId: number;
    matchId: number;
    requesterTelegramUserId: number;
    target: RemoveVoteTarget;
  }): Promise<VoteRemovalResult> {
    const match = this.options.repositories.matches.findById(input.matchId);
    if (match === undefined || match.chatId !== input.chatId) {
      return { status: "ignored", answer: `Матч #v${input.matchId} не найден.` };
    }
    if (match.creatorTelegramUserId !== input.requesterTelegramUserId) {
      return { status: "ignored", answer: "Управлять голосованием может только его создатель" };
    }
    if (!(await this.options.isAdmin(input.requesterTelegramUserId))) {
      return { status: "ignored", answer: "Недостаточно прав" };
    }
    if (this.options.repositories.processedUpdates.findByUpdateId(input.updateId) !== undefined) {
      return { status: "ignored", answer: "Это удаление уже обработано" };
    }
    if (match.status !== "active" && match.status !== "confirmed") {
      return { status: "ignored", answer: alreadyInactive(match) };
    }

    const targetLabel = input.target.kind === "username"
      ? `@${input.target.username}`
      : `ID ${input.target.telegramUserId}`;
    let targetTelegramUserId: number;
    if (input.target.kind === "username") {
      const matches = this.options.repositories.votes.findByMatchIdAndUsername(
        match.id,
        input.target.username,
      );
      if (matches.length === 0) {
        return {
          status: "ignored",
          answer: `Голос игрока ${targetLabel} в матче #v${match.id} не найден.`,
        };
      }
      if (matches.length > 1) {
        return {
          status: "ignored",
          answer: `По username ${targetLabel} найдено несколько голосов в матче #v${match.id}. Используйте Telegram ID.`,
        };
      }
      targetTelegramUserId = matches[0]?.telegramUserId as number;
    } else {
      if (this.options.repositories.votes.find(match.id, input.target.telegramUserId) === undefined) {
        return {
          status: "ignored",
          answer: `Голос игрока ${targetLabel} в матче #v${match.id} не найден.`,
        };
      }
      targetTelegramUserId = input.target.telegramUserId;
    }

    const result = this.options.repositories.matchActions.removeVote({
      updateId: input.updateId,
      matchId: match.id,
      telegramUserId: input.requesterTelegramUserId,
      targetTelegramUserId,
    });
    if (result.status === "duplicate") {
      return { status: "ignored", answer: "Это удаление уже обработано" };
    }
    if (result.status === "missing_match") {
      return { status: "ignored", answer: `Матч #v${input.matchId} не найден.` };
    }
    if (result.status === "inactive_match") {
      return { status: "ignored", answer: alreadyInactive(result.match) };
    }
    if (result.status === "vote_not_found") {
      return {
        status: "ignored",
        answer: `Голос игрока ${targetLabel} в матче #v${match.id} не найден.`,
      };
    }

    const transition = evaluateVoteTransition({
      previousOption: result.removedVote.option,
      nextOption: null,
      goingCountBefore: result.goingCountBefore,
      threshold: result.match.requiredPlayers,
      eventKey: String(input.updateId),
    });
    await this.sendClaimedNotification(
      transition.thresholdLostNotificationKey === undefined
        ? undefined
        : {
            matchId: result.match.id,
            notificationType: "threshold_lost",
            transitionKey: transition.thresholdLostNotificationKey,
            text: formatThresholdLostNotification(
              result.match.id,
              result.match.title,
              transition.goingCountAfter,
              result.match.requiredPlayers,
            ),
          },
    );
    await this.options.refreshCard(result.match.id);

    const displayName = result.removedVote.displayNameSnapshot.trim() || "Игрок";
    return {
      status: "removed",
      answer: `Голос игрока «${displayName}» в матче #v${result.match.id} удалён.`,
      vote: result.removedVote,
    };
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

    if (update.action.kind === "edit") {
      if (match.status !== "active" && match.status !== "confirmed") {
        return { status: "ignored", answer: alreadyInactive(match) };
      }
      if (this.options.showEditPrompt === undefined) {
        return { status: "ignored", answer: "Редактирование сейчас недоступно" };
      }
      await this.options.showEditPrompt(match, update.telegramUserId);
      return { status: "processed", answer: "Шаблон для редактирования отправлен", action: update.action };
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
        text: formatCancellationNotification(match.id, match.cancellationReason),
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
