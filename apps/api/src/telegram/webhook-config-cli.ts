import { resolve } from "node:path";

import { deriveTelegramWebhookSecret } from "../config/api-config.js";

export const TELEGRAM_WEBHOOK_CONFIRMATION_FLAG = "--confirm-telegram-webhook" as const;

function argumentValue(argumentsToParse: readonly string[], name: string): string | undefined {
  const index = argumentsToParse.indexOf(name);
  return index < 0 ? undefined : argumentsToParse[index + 1];
}

export function validateTelegramWebhookUrl(value: string | undefined): string {
  if (value === undefined) throw new Error("--url is required");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--url must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("--url must be an absolute HTTPS URL without credentials, query, or fragment");
  }
  if (!parsed.pathname.endsWith("/v1/telegram/webhook")) {
    throw new Error("--url must end with /v1/telegram/webhook");
  }
  return parsed.toString();
}

export async function registerTelegramPollWebhook(
  token: string,
  url: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImplementation(`https://api.telegram.org/bot${encodeURIComponent(token)}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: deriveTelegramWebhookSecret(token),
      allowed_updates: ["poll"],
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json().catch(() => undefined) as { readonly ok?: unknown } | undefined;
  if (!response.ok || payload?.ok !== true) throw new Error("Telegram poll webhook registration failed");
}

async function main(): Promise<void> {
  const argumentsToParse = process.argv.slice(2);
  if (!argumentsToParse.includes(TELEGRAM_WEBHOOK_CONFIRMATION_FLAG)) {
    throw new Error(`Refusing to change Telegram without ${TELEGRAM_WEBHOOK_CONFIRMATION_FLAG}`);
  }
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  if (token === undefined || token === "") throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const url = validateTelegramWebhookUrl(argumentValue(argumentsToParse, "--url"));
  await registerTelegramPollWebhook(token, url);
  process.stdout.write("Telegram poll webhook registered.\n");
}

if (process.argv[1] !== undefined && resolve(import.meta.filename) === resolve(process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`FAIL ${error instanceof Error ? error.message : "Telegram poll webhook registration failed"}\n`);
    process.exitCode = 1;
  });
}
