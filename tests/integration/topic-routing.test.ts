import { describe, expect, it, vi } from "vitest";

import { createPrivateCommandMiddleware } from "../../src/bot/create-bot.js";

function privateContext(userId: number) {
  return {
    chat: { id: userId, type: "private" },
    msg: { is_topic_message: false },
  };
}

describe("private command routing", () => {
  it("passes commands only for an authorized private chat", async () => {
    const middleware = createPrivateCommandMiddleware((userId) => userId === 7);
    const next = vi.fn(async () => undefined);

    await middleware({ ...privateContext(7), from: { id: 7 } } as never, next);
    await middleware({ ...privateContext(8), from: { id: 8 } } as never, next);
    await middleware({
      chat: { id: -1001234567890, type: "supergroup" },
      from: { id: 7 },
      msg: { is_topic_message: true, message_thread_id: 42 },
    } as never, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
