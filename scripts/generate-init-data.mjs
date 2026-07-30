#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvironmentFile = resolve(projectRoot, ".env.local");
if (existsSync(localEnvironmentFile)) process.loadEnvFile(localEnvironmentFile);

function fail(message) {
  console.error(`Unable to generate Telegram initData: ${message}`);
  process.exit(1);
}

function readArguments(argumentsToParse) {
  const values = new Map();
  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const name = argumentsToParse[index];
    if (name === "--help" || name === "-h") return { help: true, values };
    if (name === undefined || !name.startsWith("--")) fail(`Unexpected argument: ${name ?? ""}`);
    const value = argumentsToParse[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`Missing value for ${name}`);
    values.set(name.slice(2), value);
    index += 1;
  }
  return { help: false, values };
}

const parsed = readArguments(process.argv.slice(2).filter((argument) => argument !== "--"));
if (parsed.help) {
  console.info(`Usage: pnpm auth:fixture -- [options]

Options:
  --user-id <id>       Telegram user ID; defaults to TELEGRAM_OWNER_USER_ID
  --username <name>    Optional Telegram username
  --first-name <name>  Fixture first name; defaults to Local Owner
  --auth-date <unix>   Unix timestamp; defaults to the current time

The bot token is read from TELEGRAM_BOT_TOKEN or .env.local and is never printed.
`);
  process.exit(0);
}

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (botToken === undefined || botToken === "") fail("TELEGRAM_BOT_TOKEN is missing from the environment or .env.local");
const userId = parsed.values.get("user-id") ?? process.env.TELEGRAM_OWNER_USER_ID?.trim();
if (userId === undefined || !/^[1-9]\d*$/u.test(userId)) fail("--user-id or TELEGRAM_OWNER_USER_ID must be a positive decimal integer");
const authDateText = parsed.values.get("auth-date") ?? String(Math.floor(Date.now() / 1_000));
if (!/^\d+$/u.test(authDateText) || !Number.isSafeInteger(Number(authDateText))) fail("--auth-date must be a safe Unix timestamp");

const username = parsed.values.get("username")?.replace(/^@/u, "");
const user = {
  id: Number(userId),
  is_bot: false,
  first_name: parsed.values.get("first-name") ?? "Local Owner",
  ...(username === undefined || username === "" ? {} : { username }),
  language_code: "ru",
};
if (!Number.isSafeInteger(user.id)) fail("Telegram user ID must fit JavaScript's safe integer range for the signed JSON fixture");

const fields = new Map([
  ["auth_date", authDateText],
  ["query_id", `local-${randomBytes(8).toString("hex")}`],
  ["user", JSON.stringify(user)],
]);
const dataCheckString = [...fields.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");
const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
fields.set("hash", hash);

console.info(new URLSearchParams([...fields.entries()]).toString());
