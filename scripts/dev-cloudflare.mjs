#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { get as getHttp } from "node:http";
import { get as getHttps } from "node:https";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createChildProcessInvocation } from "./child-process.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvFile = resolve(projectRoot, ".env.local");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const requestedFlags = new Set(process.argv.slice(2).filter((argument) => argument !== "--"));
const knownFlags = new Set(["--help", "-h", "--set-menu-button", "--set-webhook"]);
const children = new Set();
let stopping = false;

export function validateCloudflarePublicUrl(value) {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    throw new Error("Missing CLOUDFLARE_TUNNEL_URL in .env.local.");
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("CLOUDFLARE_TUNNEL_URL must be an absolute HTTPS origin.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("CLOUDFLARE_TUNNEL_URL must be an HTTPS origin without credentials, path, query, or fragment.");
  }

  return parsed.origin;
}

export function createDevelopmentEnvironments(environment, publicUrl) {
  return {
    api: {
      ...environment,
      TELEGRAM_MINI_APP_URL: publicUrl,
      WEB_ORIGIN: publicUrl,
    },
    web: {
      ...environment,
      VITE_API_BASE_URL: publicUrl,
      VITE_API_PROXY_TARGET: "http://127.0.0.1:6000",
      VITE_PUBLIC_HOST: new URL(publicUrl).hostname,
    },
  };
}

function printUsage() {
  console.info(`Usage:
  pnpm dev
  pnpm dev -- --set-menu-button
  pnpm dev -- --set-webhook

The command starts the API and Vite behind the persistent Cloudflare Tunnel URL
configured in CLOUDFLARE_TUNNEL_URL. The cloudflared connector must already be
installed and connected on the development machine. Start local PostgreSQL and
apply migrations separately before running this command.

Options:
  --set-menu-button   Set the owner's Telegram menu button to the public Web URL.
  --set-webhook       Register the local poll and poll-answer Telegram webhook for this run.
`);
}

function fail(message) {
  console.error(`Cloudflare development setup failed: ${message}`);
  process.exit(1);
}

function startChild(command, argumentsToRun, environment) {
  const invocation = createChildProcessInvocation(command, argumentsToRun);
  const child = spawn(invocation.command, invocation.arguments, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
  });

  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      const reason = signal === null ? `exit code ${code ?? 1}` : `signal ${signal}`;
      console.error(`${command} stopped (${reason}).`);
      void shutdown(1);
    }
  });

  return child;
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveStop();
    };

    child.once("exit", finish);
    child.kill("SIGTERM");
    const forceKillTimer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, 5000);
    forceKillTimer.unref();
  });
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].reverse().map((child) => stopChild(child)));
  process.exitCode = exitCode;
}

async function wait(milliseconds) {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function waitForHttp(url, label) {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const statusCode = await new Promise((resolveStatus, rejectStatus) => {
        const request = (url.startsWith("https:") ? getHttps : getHttp)(url, (response) => {
          response.resume();
          resolveStatus(response.statusCode ?? 0);
        });
        request.setTimeout(3000, () => request.destroy(new Error("Request timed out")));
        request.once("error", rejectStatus);
      });
      if (statusCode >= 200 && statusCode < 300) return;
      lastError = new Error(`HTTP ${statusCode}`);
    } catch (error) {
      lastError = error;
    }

    await wait(250);
  }

  throw new Error(
    `Timed out waiting for ${label}${lastError instanceof Error ? `: ${lastError.message}` : "."}`,
  );
}

async function telegramApi(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? `HTTP ${response.status}`}`);
  }

  return payload.result;
}

async function main() {
  for (const flag of requestedFlags) {
    if (!knownFlags.has(flag)) {
      console.error(`Unknown option: ${flag}`);
      printUsage();
      process.exitCode = 2;
      return;
    }
  }

  if (requestedFlags.has("--help") || requestedFlags.has("-h")) {
    printUsage();
    return;
  }

  if (!existsSync(localEnvFile)) fail("Missing .env.local. Copy .env.local.example to .env.local first.");

  process.loadEnvFile(localEnvFile);
  const childEnvironment = { ...process.env };
  const requiredEnvironment = [
    "DATABASE_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_OWNER_USER_ID",
    "TELEGRAM_CHAT_ID",
    "TELEGRAM_CHAT_TOPIC_ID",
    "TELEGRAM_GENERAL_TOPIC_ID",
  ];

  for (const name of requiredEnvironment) {
    if (childEnvironment[name]?.trim() === undefined || childEnvironment[name]?.trim() === "") {
      fail(`Missing ${name} in .env.local.`);
    }
  }

  const publicUrl = validateCloudflarePublicUrl(childEnvironment.CLOUDFLARE_TUNNEL_URL);
  const environments = createDevelopmentEnvironments(childEnvironment, publicUrl);

  startChild(
    process.execPath,
    [resolve(projectRoot, "scripts/run-tsx.mjs"), "--tsconfig", "apps/api/tsconfig.json", "apps/api/src/main.ts"],
    environments.api,
  );
  startChild(packageManager, ["--filter", "@football/web", "dev", "--host", "127.0.0.1"], environments.web);

  await Promise.all([
    waitForHttp("http://127.0.0.1:6000/health", "the local API"),
    waitForHttp("http://127.0.0.1:6173/", "the local Web app"),
    waitForHttp(`${publicUrl}/`, "the public Cloudflare Tunnel route"),
  ]);

  console.info(`
Local Telegram development is ready.
  Mini App: ${publicUrl}
  API:      ${publicUrl}/v1

The persistent Cloudflare Tunnel connector is managed outside this process.
Open the Mini App from the local test bot using the URL above.
`);

  const telegramToken = childEnvironment.TELEGRAM_BOT_TOKEN;
  if (requestedFlags.has("--set-menu-button")) {
    await telegramApi(telegramToken, "setChatMenuButton", {
      chat_id: childEnvironment.TELEGRAM_OWNER_USER_ID,
      menu_button: {
        type: "web_app",
        text: "Football Bot",
        web_app: { url: publicUrl },
      },
    });
    console.info("The owner's local Telegram menu button was configured.");
  }

  if (requestedFlags.has("--set-webhook")) {
    const secretToken = createHash("sha256")
      .update(`football-bot-poll-webhook:${telegramToken}`, "utf8")
      .digest("hex");
    await telegramApi(telegramToken, "setWebhook", {
      url: `${publicUrl}/v1/telegram/webhook`,
      secret_token: secretToken,
      allowed_updates: ["poll", "poll_answer"],
    });
    console.info("The local poll and poll-answer Telegram webhook was configured.");
  }

  await new Promise(() => {});
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === resolve(fileURLToPath(import.meta.url))) {
  void main().catch(async (error) => {
    console.error(`Cloudflare development setup failed: ${error instanceof Error ? error.message : String(error)}`);
    await shutdown(1);
  });
}
