import { parseApiConfig } from "../config/api-config.js";
import { inspectTelegramWebhook } from "./webhook-status.js";

function expectedUrlFromArguments(argumentsToParse: readonly string[]): string {
  const argument = argumentsToParse.find((value) => value.startsWith("--expected-url="));
  const value = argument?.slice("--expected-url=".length);
  if (value === undefined || value.trim() === "") throw new Error("--expected-url is required");
  return value;
}

async function main(): Promise<void> {
  const config = parseApiConfig(process.env);
  const status = await inspectTelegramWebhook({
    botToken: config.telegramBotToken,
    expectedUrl: expectedUrlFromArguments(process.argv.slice(2)),
  });
  console.info(JSON.stringify(status));
}

void main().catch(() => {
  console.error("Telegram webhook status check failed.");
  process.exitCode = 1;
});
