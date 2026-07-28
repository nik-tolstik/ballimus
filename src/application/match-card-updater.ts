import type { Match, MatchMessageKind, Vote } from "../db/schema.js";
import { adminPanelContent, matchCardContent } from "./match-card.js";
import type { MatchCardPublisher } from "./match-creation.js";

export interface MatchCardUpdaterRepositories {
  matches: {
    findById(matchId: number): Match | undefined;
  };
  matchMessages: {
    findByMatchIdAndKind(matchId: number, kind: MatchMessageKind): {
      chatId: number;
      messageId: number;
    } | undefined;
  };
  votes: {
    listByMatchId(matchId: number): Vote[];
  };
  externalParticipants: {
    countByMatchId(matchId: number): number;
  };
}

export class MatchCardUpdater {
  public constructor(
    private readonly repositories: MatchCardUpdaterRepositories,
    private readonly publisher: Pick<MatchCardPublisher, "editMessage">,
  ) {}

  public async refresh(matchId: number): Promise<void> {
    const match = this.repositories.matches.findById(matchId);
    const publicMessage = this.repositories.matchMessages.findByMatchIdAndKind(
      matchId,
      "public_card",
    );
    if (match === undefined || publicMessage === undefined || this.publisher.editMessage === undefined) {
      return;
    }

    const votes = this.repositories.votes.listByMatchId(matchId);
    const externalCount = this.repositories.externalParticipants.countByMatchId(matchId);
    const card = matchCardContent(match, votes, externalCount);
    await this.safeEdit({
      chatId: publicMessage.chatId,
      messageId: publicMessage.messageId,
      text: card.text,
      replyMarkup: card.replyMarkup,
    });

    const adminMessage = this.repositories.matchMessages.findByMatchIdAndKind(
      matchId,
      "admin_panel",
    );
    if (adminMessage === undefined) return;

    const admin = adminPanelContent(match);
    await this.safeEdit({
      chatId: adminMessage.chatId,
      messageId: adminMessage.messageId,
      text: admin.text,
      replyMarkup: admin.replyMarkup,
    });
  }

  private async safeEdit(request: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: import("grammy/types").InlineKeyboardMarkup | undefined;
  }): Promise<void> {
    try {
      await this.publisher.editMessage?.(request);
    } catch (error) {
      if (error instanceof Error && /message is not modified/i.test(error.message)) return;
      console.error(`Match card update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
