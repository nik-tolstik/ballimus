import type { ExternalParticipant, Match, MatchMessageKind, Vote } from "../db/schema.js";
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
    listByMatchId?(matchId: number): ExternalParticipant[];
  };
}

export class MatchCardUpdater {
  public constructor(
    private readonly repositories: MatchCardUpdaterRepositories,
    private readonly publisher: Pick<MatchCardPublisher, "deleteMessage" | "editMessage">,
    private readonly timezone = "Europe/Minsk",
  ) {}

  public async refresh(matchId: number): Promise<void> {
    const match = this.repositories.matches.findById(matchId);
    const publicMessage = this.repositories.matchMessages.findByMatchIdAndKind(
      matchId,
      "public_card",
    );
    if (match === undefined) return;

    const votes = this.repositories.votes.listByMatchId(matchId);
    const externalCount = this.repositories.externalParticipants.countByMatchId(matchId);
    const externalParticipants = this.repositories.externalParticipants.listByMatchId?.(matchId) ?? [];
    if (publicMessage !== undefined) {
      const card = matchCardContent(match, votes, externalCount, externalParticipants, {
        timezone: this.timezone,
      });
      if (match.status === "completed" || match.status === "cancelled") {
        const deleted = await this.safeDelete({
          chatId: publicMessage.chatId,
          messageId: publicMessage.messageId,
        });
        if (!deleted) {
          await this.safeEdit({
            chatId: publicMessage.chatId,
            messageId: publicMessage.messageId,
            text: card.text,
            replyMarkup: card.replyMarkup,
          });
        }
      } else {
        await this.safeEdit({
          chatId: publicMessage.chatId,
          messageId: publicMessage.messageId,
          text: card.text,
          replyMarkup: card.replyMarkup,
        });
      }
    }

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

  private async safeDelete(request: { chatId: number; messageId: number }): Promise<boolean> {
    if (this.publisher.deleteMessage === undefined) return false;

    try {
      await this.publisher.deleteMessage(request);
      return true;
    } catch (error) {
      if (error instanceof Error && /message to delete not found/i.test(error.message)) return true;
      console.error(`Match card deletion failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
