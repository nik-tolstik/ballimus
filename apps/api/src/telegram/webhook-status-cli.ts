import { resolve } from "node:path";

export interface TelegramWebhookStatus {
  readonly url: string;
  readonly pendingUpdateCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns only non-secret fields from Telegram's getWebhookInfo response. */
export function parseTelegramWebhookStatus(payload: unknown): TelegramWebhookStatus {
  if (!isRecord(payload) || payload["ok"] !== true) {
    throw new Error("Telegram webhook status response was invalid");
  }

  const result = payload["result"];
  if (!isRecord(result)) throw new Error("Telegram webhook status response was invalid");

  const url = result["url"];
  const pendingUpdateCount = result["pending_update_count"];
  if (
    typeof url !== "string"
    || typeof pendingUpdateCount !== "number"
    || !Number.isSafeInteger(pendingUpdateCount)
    || pendingUpdateCount < 0
  ) {
    throw new Error("Telegram webhook status response was invalid");
  }

  return { url, pendingUpdateCount };
}

function botToken(environment: NodeJS.ProcessEnv): string {
  const token = environment["TELEGRAM_BOT_TOKEN"]?.trim();
  if (token === undefined || token === "") throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

export async function fetchTelegramWebhookStatus(
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<TelegramWebhookStatus> {
  let response: Response;
  try {
    response = await fetchImplementation(`https://api.telegram.org/bot${encodeURIComponent(token)}/getWebhookInfo`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error("Telegram webhook status request failed");
  }

  if (!response.ok) throw new Error("Telegram webhook status request failed");

  try {
    return parseTelegramWebhookStatus(await response.json());
  } catch {
    throw new Error("Telegram webhook status response was invalid");
  }
}

async function main(): Promise<void> {
  try {
    const status = await fetchTelegramWebhookStatus(botToken(process.env));
    process.stdout.write(`${JSON.stringify(status)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram webhook status could not be read";
    process.stderr.write(`FAIL ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(import.meta.filename) === resolve(process.argv[1])) {
  void main();
}
