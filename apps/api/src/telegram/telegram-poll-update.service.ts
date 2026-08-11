import { timingSafeEqual } from "node:crypto";

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { OutboxRepository, TelegramPollsRepository, type AppDatabase, type TelegramPoll } from "@football/db";

import { API_CONFIG, type ApiConfig } from "../config/api-config.js";
import { APP_DATABASE } from "../database/database.constants.js";
import { OutboxBestEffortService } from "./outbox-best-effort.service.js";

export interface ParsedTelegramPollUpdate {
  readonly pollId: string;
  readonly options: readonly { readonly text: string; readonly voterCount: number }[];
  readonly isClosed: boolean;
}

export function pollThresholdNotificationTarget(
  config: Pick<ApiConfig, "telegramChatTopicId">,
  poll: Pick<TelegramPoll, "telegramChatId">,
): { readonly telegramChatId: bigint; readonly telegramTopicId: bigint } {
  return {
    telegramChatId: poll.telegramChatId,
    telegramTopicId: config.telegramChatTopicId,
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parseTelegramPollUpdate(value: unknown): ParsedTelegramPollUpdate | undefined {
  const update = objectValue(value);
  const poll = objectValue(update?.["poll"]);
  if (poll === undefined) return undefined;
  const pollId = poll["id"];
  const isClosed = poll["is_closed"];
  const rawOptions = poll["options"];
  if (typeof pollId !== "string" || pollId.trim() === "" || typeof isClosed !== "boolean" || !Array.isArray(rawOptions)) {
    return undefined;
  }
  const options: { text: string; voterCount: number }[] = [];
  for (const rawOption of rawOptions) {
    const option = objectValue(rawOption);
    const text = option?.["text"];
    const voterCount = option?.["voter_count"];
    if (typeof text !== "string" || !Number.isSafeInteger(voterCount) || Number(voterCount) < 0) return undefined;
    options.push({ text, voterCount: Number(voterCount) });
  }
  return { pollId, options, isClosed };
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/** Applies authenticated Telegram poll counts and queues one notification per configured threshold. */
@Injectable()
export class TelegramPollUpdateService {
  public constructor(
    @Inject(APP_DATABASE) private readonly db: AppDatabase,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(OutboxBestEffortService) private readonly bestEffort: OutboxBestEffortService,
  ) {}

  public async handle(secret: string | undefined, body: unknown): Promise<{ readonly ok: true }> {
    if (!secretMatches(secret, this.config.telegramWebhookSecret)) {
      throw new UnauthorizedException({ code: "TELEGRAM_WEBHOOK_UNAUTHORIZED", message: "Telegram webhook authentication failed." });
    }
    const update = parseTelegramPollUpdate(body);
    if (update === undefined) return { ok: true };

    const queued = await this.db.transaction(async (tx) => {
      const polls = new TelegramPollsRepository(tx);
      const current = await polls.getByTelegramPollIdForUpdate(update.pollId);
      if (current === undefined) return 0;
      const applied = await polls.applyTelegramUpdate(current, update.options, update.isClosed);
      const outbox = new OutboxRepository(tx);
      const notificationTarget = pollThresholdNotificationTarget(this.config, current);
      for (const trigger of applied.triggers) {
        await outbox.insertInTransaction({
          eventType: "send_poll_threshold_notification",
          deduplicationKey: `poll:${current.id.toString(10)}:option:${String(trigger.optionIndex)}:threshold:${String(trigger.threshold)}`,
          ...notificationTarget,
          payload: {
            pollId: current.id.toString(10),
            question: current.question,
            optionText: trigger.optionText,
            optionIndex: trigger.optionIndex,
            threshold: trigger.threshold,
            voterCount: trigger.voterCount,
          },
        });
      }
      return applied.triggers.length;
    });

    if (queued > 0) {
      try {
        await this.bestEffort.dispatch();
      } catch {
        // The durable jobs runner retries threshold notifications.
      }
    }
    return { ok: true };
  }
}
