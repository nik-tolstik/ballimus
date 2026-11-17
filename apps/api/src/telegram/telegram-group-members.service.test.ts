import { beforeEach, expect, it, vi } from "vitest";

import type { ApiConfig } from "../config/api-config.js";
import type { TelegramBotService } from "./telegram-effects.js";
import { TelegramGroupMembersService } from "./telegram-group-members.service.js";

const transport = vi.hoisted(() => ({
  start: vi.fn(),
  resolvePeer: vi.fn(),
  iterChatMembers: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@mtcute/node", () => ({
  TelegramClient: class { constructor() { return transport; } },
  MemoryStorage: class {},
}));

const config = {
  telegramMtproto: { apiId: 123, apiHash: "fixture" },
  telegramBotToken: "test-token",
  telegramOwnerUserId: 1n,
  telegramGroupChatId: -1001234567890n,
} as ApiConfig;
const getChatMemberCount = vi.fn<TelegramBotService["getChatMemberCount"]>();
const bot = { getChatMemberCount, isHumanChatMember: vi.fn<TelegramBotService["isHumanChatMember"]>() };

beforeEach(() => {
  vi.clearAllMocks();
  transport.start.mockResolvedValue(undefined);
  transport.destroy.mockResolvedValue(undefined);
  transport.resolvePeer.mockResolvedValue("configured-group-peer");
  transport.iterChatMembers.mockImplementation(async function* () {
    yield { status: "creator", user: { id: 1, displayName: "Owner" } };
    yield { status: "member", user: { id: 2, displayName: "Player", username: "player" } };
    yield { status: "member", user: { id: 3, isBot: true } };
    yield { status: "left", user: { id: 4, displayName: "Former player" } };
  });
});

it("lists current human group members who can be granted access", async () => {
  getChatMemberCount.mockResolvedValue(3);
  const service = new TelegramGroupMembersService(config, bot);
  const candidates = [{ telegramUserId: "2", displayName: "Player", username: "player" }];
  await expect(Promise.all([service.list(), service.list()])).resolves.toEqual([candidates, candidates]);
  expect(transport.resolvePeer).toHaveBeenCalledWith(Number(config.telegramGroupChatId));
  expect(transport.iterChatMembers).toHaveBeenCalledOnce();
  await service.onModuleDestroy();
});

it("rejects an incomplete directory instead of displaying a partial list", async () => {
  getChatMemberCount.mockResolvedValue(4);
  const service = new TelegramGroupMembersService(config, bot);
  await expect(service.list()).rejects.toMatchObject({
    response: { code: "TELEGRAM_GROUP_MEMBERS_UNAVAILABLE" },
  });
  expect(transport.destroy).toHaveBeenCalledOnce();
});
