import "reflect-metadata";

import { createHmac } from "node:crypto";
import { BadRequestException, Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { MiniAppAdminsRepository } from "@football/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { MiniAppAccessService } from "../auth/mini-app-access.service.js";
import { MiniAppAuthGuard } from "../auth/mini-app-auth.guard.js";
import { API_CONFIG } from "../config/api-config.js";
import { APP_DATABASE } from "../database/database.constants.js";
import { TelegramGroupMembersService } from "../telegram/telegram-group-members.service.js";
import { AccessController } from "./access.controller.js";
import { MatchesController, PollsController, VenuesController, WeatherController } from "./rest.controller.js";
import { RestService } from "./rest.service.js";

const botToken = "fixture:telegram-token";
const ownerId = 100;
const adminId = 5_000_000_002;
const assignments = new Set<bigint>();
const createMatch = vi.fn<RestService["createMatch"]>().mockResolvedValue({});
const createPoll = vi.fn<RestService["createPoll"]>().mockResolvedValue({});
const createVenue = vi.fn<RestService["createVenue"]>().mockResolvedValue({});

@Module({
  controllers: [AccessController, MatchesController, PollsController, VenuesController, WeatherController],
  providers: [
    MiniAppAccessService,
    { provide: APP_GUARD, useClass: MiniAppAuthGuard },
    { provide: API_CONFIG, useValue: { telegramBotToken: botToken, telegramOwnerUserId: BigInt(ownerId), miniAppInitDataMaxAgeSeconds: 60 } },
    { provide: APP_DATABASE, useValue: {} },
    { provide: TelegramGroupMembersService, useValue: {
      list: async () => [{ telegramUserId: String(adminId), displayName: "Test player", username: null }],
      assertMember: async (id: bigint) => {
        if (id !== BigInt(adminId)) throw new BadRequestException({ code: "TELEGRAM_GROUP_MEMBER_REQUIRED" });
      },
    } },
    { provide: RestService, useValue: { createMatch, createPoll, createVenue, sendCurrentWeather: () => ({}) } },
  ],
})
class AccessTestModule {}

function signedInitData(userId: number, authDate = Math.floor(Date.now() / 1000)): URLSearchParams {
  const data = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id: userId }) });
  const signingKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const payload = [...data].map(([key, value]) => `${key}=${value}`).join("\n");
  data.set("hash", createHmac("sha256", signingKey).update(payload).digest("hex"));
  return data;
}

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  vi.spyOn(MiniAppAdminsRepository.prototype, "has").mockImplementation(async (id) => assignments.has(id));
  vi.spyOn(MiniAppAdminsRepository.prototype, "list").mockImplementation(async () => [...assignments]);
  vi.spyOn(MiniAppAdminsRepository.prototype, "grant").mockImplementation(async (id) => { assignments.add(id); });
  vi.spyOn(MiniAppAdminsRepository.prototype, "revoke").mockImplementation(async (id) => { assignments.delete(id); });
  app = await NestFactory.create(AccessTestModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  vi.restoreAllMocks();
});

function request(path: string, initData: URLSearchParams, method = "GET"): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method, headers: { "X-Telegram-Init-Data": initData.toString() } });
}

it("lets only the owner grant and revoke access and checks it on every management request", async () => {
  const ownerSession = signedInitData(ownerId);
  const adminSession = signedInitData(adminId);
  const adminPath = `/access/admins/${adminId}`;
  const managementRoutes = ["/matches", "/polls", "/venues"];

  expect(await (await request("/access/session", adminSession)).json()).toEqual({ role: "guest", telegramUserId: String(adminId) });
  for (const path of managementRoutes) {
    expect((await request(path, adminSession, "POST")).status).toBe(403);
  }

  expect((await request("/access/admins/0", ownerSession, "PUT")).status).toBe(400);
  expect((await request("/access/admins/9007199254740992", ownerSession, "PUT")).status).toBe(400);
  expect((await request(`/access/admins/${ownerId}`, ownerSession, "PUT")).status).toBe(400);
  expect((await request(`/access/admins/${ownerId}`, ownerSession, "DELETE")).status).toBe(400);
  expect((await request("/access/group-members", adminSession)).status).toBe(403);
  expect(await (await request("/access/group-members", ownerSession)).json()).toEqual({
    members: [{ telegramUserId: String(adminId), displayName: "Test player", username: null }],
  });
  const outsider = await request("/access/admins/300", ownerSession, "PUT");
  expect(outsider.status).toBe(400);
  expect(await outsider.json()).toEqual({ code: "TELEGRAM_GROUP_MEMBER_REQUIRED" });
  expect((await request(adminPath, ownerSession, "PUT")).status).toBe(204);
  expect(await (await request("/access/admins", ownerSession)).json()).toEqual({ telegramUserIds: [String(adminId)] });

  expect(await (await request("/access/session", adminSession)).json()).toEqual({ role: "admin", telegramUserId: String(adminId) });
  for (const path of managementRoutes) {
    expect((await request(path, adminSession, "POST")).status).toBe(201);
  }
  for (const create of [createMatch, createPoll, createVenue]) {
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toBe(BigInt(adminId));
  }
  expect((await request("/access/admins", adminSession)).status).toBe(403);
  expect((await request("/access/group-members", adminSession)).status).toBe(403);
  expect((await request("/access/admins/300", adminSession, "PUT")).status).toBe(403);
  expect((await request(adminPath, adminSession, "DELETE")).status).toBe(403);
  expect((await request("/weather/current", adminSession, "POST")).status).toBe(403);
  expect((await request("/weather/current", ownerSession, "POST")).status).toBe(200);

  const tampered = new URLSearchParams(adminSession);
  tampered.set("user", JSON.stringify({ id: ownerId }));
  expect((await request("/access/admins/300", tampered, "PUT")).status).toBe(401);
  expect((await request("/access/session", signedInitData(ownerId, 1))).status).toBe(401);

  expect((await request(adminPath, ownerSession, "DELETE")).status).toBe(204);
  expect(await (await request("/access/admins", ownerSession)).json()).toEqual({ telegramUserIds: [] });
  expect((await request("/polls", adminSession, "POST")).status).toBe(403);
  expect((await request("/polls", ownerSession, "POST")).status).toBe(201);
});
