import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiConfig } from "../config/api-config.js";
import { TelegramBotService } from "./telegram-effects.js";

const apiConfig = {
  telegramBotToken: "test-token",
} as ApiConfig;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TelegramBotService", () => {
  it("sends polls through the native fetch transport without a General thread id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        message_id: 42,
        poll: {
          id: "poll-42",
          options: [
            { text: "Tuesday", voter_count: 0 },
            { text: "Saturday", voter_count: 0 },
          ],
        },
      },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new TelegramBotService(apiConfig);
    await expect(service.sendPoll({
      chatId: -1001n,
      question: "When can you play?",
      options: ["Tuesday", "Saturday"],
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
    })).resolves.toEqual({
      pollId: "poll-42",
      messageId: 42n,
      options: [
        { text: "Tuesday", voterCount: 0 },
        { text: "Saturday", voterCount: 0 },
      ],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_id: "-1001",
      question: "When can you play?",
      is_anonymous: false,
      allows_multiple_answers: false,
      allows_revoting: true,
      options: [{ text: "Tuesday" }, { text: "Saturday" }],
    });
    expect(JSON.parse(String(request.body))).not.toHaveProperty("message_thread_id");
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });
});
