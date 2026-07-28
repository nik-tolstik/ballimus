import type { Match, MatchMessage } from "../../src/db/schema.js";
import {
  MatchCreationAuthorizationError,
  MatchCreationService,
  type MatchCardPublisher,
  type MatchCreationRepositories,
} from "../../src/application/match-creation.js";
import type { MatchDraft } from "../../src/parser/match-parser.js";
import { describe, expect, it } from "vitest";

const draft: MatchDraft = {
  date: "2026-07-27",
  time: "20:00",
  location: "СОК Олимпийский",
  venueType: "outdoor",
  requiredPlayers: 3,
};

function fixture() {
  let nextMatchId = 1;
  let nextMessageId = 20;
  const matches: Match[] = [];
  const messages: MatchMessage[] = [];
  const publicCards: Array<{ text: string; messageId: number }> = [];
  const adminPanels: Array<{ text: string; messageId: number }> = [];
  const edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];

  const repositories: MatchCreationRepositories = {
    matches: {
      create: (input) => {
        const value = {
          id: nextMatchId++,
          ...input,
          venueType: input.venueType ?? null,
          cancellationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Match;
        matches.push(value);
        return value;
      },
      updateStatus: (id, status) => {
        const match = matches.find((item) => item.id === id);
        if (match === undefined) return undefined;
        const updated = { ...match, status, updatedAt: new Date() } as Match;
        matches[matches.indexOf(match)] = updated;
        return updated;
      },
      findById: (id) => matches.find((item) => item.id === id),
      delete: (id) => {
        const index = matches.findIndex((item) => item.id === id);
        if (index === -1) return false;
        matches.splice(index, 1);
        return true;
      },
    },
    matchMessages: {
      upsert: (input) => {
        const value = { id: messages.length + 1, ...input, createdAt: new Date() } as MatchMessage;
        messages.push(value);
        return value;
      },
      findByChatAndMessageId: (chatId, messageId, kind) =>
        messages.find(
          (message) =>
            message.chatId === chatId &&
            message.messageId === messageId &&
            (kind === undefined || message.kind === kind),
        ),
    },
  };

  const cardPublisher: MatchCardPublisher = {
    sendPublicCard: async (request) => {
      const messageId = nextMessageId++;
      publicCards.push({ text: request.text, messageId });
      return { messageId };
    },
    sendAdminPanel: async (request) => {
      const messageId = nextMessageId++;
      adminPanels.push({ text: request.text, messageId });
      return { messageId };
    },
    editMessage: async (request) => {
      edits.push({ chatId: request.chatId, messageId: request.messageId, text: request.text });
    },
    deleteMessage: async (request) => {
      deletedMessages.push(request);
    },
  };

  return {
    repositories,
    cardPublisher,
    matches,
    messages,
    publicCards,
    adminPanels,
    edits,
    deletedMessages,
  };
}

describe("match creation service", () => {
  it("creates a private preview without publishing a public card", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
    });

    const result = await service.createDraft({
      idempotencyKey: "preview-1",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft,
    });

    expect(result.match.status).toBe("draft");
    expect(result.previewMessage.messageId).toBe(20);
    expect(test.publicCards).toHaveLength(0);
    expect(test.adminPanels).toHaveLength(1);
    expect(test.adminPanels[0]?.text).toContain("Предпросмотр матча #v1");
    expect(test.adminPanels[0]?.text).toContain("Формат: на улице");
    expect(test.adminPanels[0]?.text).toContain("Место: СОК Олимпийский");
    expect(test.adminPanels[0]?.text).toContain("Сумма: не указана");
    expect(test.messages.map((message) => message.kind)).toEqual(["admin_panel"]);
  });

  it("publishes a draft only after its creator confirms the preview", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });
    const preview = await service.createDraft({
      idempotencyKey: "preview-publish",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft,
    });

    const result = await service.processDraftAction({
      telegramUserId: 7,
      chatId: 7,
      messageId: preview.previewMessage.messageId,
      generalTopicId: 2,
      action: { kind: "publish", matchId: preview.match.id },
    });

    expect(result.status).toBe("published");
    expect(test.matches[0]?.status).toBe("active");
    expect(test.publicCards).toHaveLength(1);
    expect(test.publicCards[0]?.text).toContain("#v1");
    expect(test.edits).toHaveLength(1);
    expect(test.messages.map((message) => message.kind)).toEqual([
      "admin_panel",
      "public_card",
    ]);
  });

  it("discards a draft when the creator chooses to edit it", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
    });
    const preview = await service.createDraft({
      idempotencyKey: "preview-edit",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft,
    });

    const result = await service.processDraftAction({
      telegramUserId: 7,
      chatId: 7,
      messageId: preview.previewMessage.messageId,
      generalTopicId: 2,
      action: { kind: "edit", matchId: preview.match.id },
    });

    expect(result).toMatchObject({
      status: "discarded",
      answer: "Черновик удалён. Отправьте новый /match с исправленными данными.",
    });
    expect(test.matches).toHaveLength(0);
    expect(test.publicCards).toHaveLength(0);
    expect(test.deletedMessages).toEqual([{ chatId: 7, messageId: 20 }]);
  });

  it("creates a public card and a private admin panel", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    const result = await service.create({
      idempotencyKey: "update-1",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft,
    });

    expect(result.publicMessage.messageId).toBe(20);
    expect(result.adminMessage.messageId).toBe(21);
    expect(result.match.status).toBe("active");
    expect(result.match.title).toBe("27.07.2026 20:00 — СОК Олимпийский");
    expect(test.publicCards[0]?.text).toContain("#v1");
    expect(test.publicCards[0]?.text).toContain("27.07.2026 20:00");
    expect(test.publicCards[0]?.text).toContain("Сумма: не указана");
    expect(test.publicCards[0]?.text).toContain("Место: СОК Олимпийский");
    expect(test.adminPanels[0]?.text).toContain("Управление матчем #v1");
    expect(test.edits).toHaveLength(2);
    expect(test.messages.map((message) => message.kind)).toEqual([
      "public_card",
      "admin_panel",
    ]);
  });

  it("renders placeholders when time and location are unknown", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
    });

    const result = await service.create({
      idempotencyKey: "unknown-details",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft: { ...draft, time: null, location: null },
    });

    expect(result.match.scheduledAt).toBeNull();
    expect(test.publicCards[0]?.text).toContain("27.07.2026 время уточняется");
  });

  it("keeps approximate time labels and field prices", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
    });

    await service.create({
      idempotencyKey: "approximate-with-price",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft: {
        ...draft,
        time: null,
        location: "BOX365",
        fieldPriceRubles: 100,
        dateLabel: "Четверг",
        timeLabel: "20:00-21:30",
      },
    });

    expect(test.publicCards[0]?.text).toContain("Четверг 20:00-21:30");
    expect(test.publicCards[0]?.text).toContain("Сумма: 100 рублей");
    expect(test.publicCards[0]?.text).toContain("Место: BOX365");
  });

  it("uses Today in the public card for a match held today", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await service.create({
      idempotencyKey: "today",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft,
    });

    expect(test.publicCards[0]?.text).toContain("Сегодня 20:00");
  });

  it("returns the cached result for a duplicate idempotency key", async () => {
    const test = fixture();
    let sends = 0;
    const publisher: MatchCardPublisher = {
      ...test.cardPublisher,
      sendPublicCard: async (request) => {
        sends += 1;
        return test.cardPublisher.sendPublicCard(request);
      },
    };
    const service = new MatchCreationService({ repositories: test.repositories, cardPublisher: publisher });
    const input = {
      idempotencyKey: "same-update",
      chatId: -100,
      generalTopicId: 2,
      timezone: "Europe/Minsk",
      creatorTelegramUserId: 7,
      draft,
    };

    const first = await service.create(input);
    const second = await service.create(input);

    expect(second).toBe(first);
    expect(sends).toBe(1);
    expect(test.matches).toHaveLength(1);
  });

  it("cleans up the draft and sent card when persistence fails", async () => {
    const test = fixture();
    const failingRepositories: MatchCreationRepositories = {
      ...test.repositories,
      matchMessages: {
        ...test.repositories.matchMessages,
        upsert: () => {
          throw new Error("database unavailable");
        },
      },
    };
    const service = new MatchCreationService({
      repositories: failingRepositories,
      cardPublisher: test.cardPublisher,
    });

    await expect(
      service.create({
        idempotencyKey: "failure",
        chatId: -100,
        generalTopicId: 2,
        timezone: "Europe/Minsk",
        creatorTelegramUserId: 7,
        draft,
      }),
    ).rejects.toThrow("Match and card creation failed");
    expect(test.matches).toHaveLength(0);
    expect(test.deletedMessages).toEqual([{ chatId: -100, messageId: 20 }]);
  });

  it("rejects unauthorized creators before creating anything", async () => {
    const test = fixture();
    const service = new MatchCreationService({
      repositories: test.repositories,
      cardPublisher: test.cardPublisher,
      authorizeCreator: () => false,
    });

    await expect(
      service.create({
        idempotencyKey: "unauthorized",
        chatId: -100,
        generalTopicId: 2,
        timezone: "Europe/Minsk",
        creatorTelegramUserId: 7,
        draft,
      }),
    ).rejects.toBeInstanceOf(MatchCreationAuthorizationError);
    expect(test.matches).toHaveLength(0);
  });
});
