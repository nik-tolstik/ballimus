import { describe, expect, it } from "vitest";

import { EMPTY_INLINE_KEYBOARD } from "./telegram-effects.js";
import { publicCardSendOptions } from "./telegram-card.service.js";

describe("read-only Telegram card transport", () => {
  it("uses no inline keyboard and omits Telegram's General topic ID", () => {
    expect(EMPTY_INLINE_KEYBOARD).toEqual({ inline_keyboard: [] });
    expect(publicCardSendOptions(1n)).toEqual({});
    expect(publicCardSendOptions(7n)).toEqual({ messageThreadId: 7 });
  });
});
