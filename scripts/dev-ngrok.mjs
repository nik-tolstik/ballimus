#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { get as getHttp } from "node:http";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvFile = resolve(projectRoot, ".env.local");
const ngrokConfigFile = resolve(projectRoot, "ngrok.local.yml");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const ngrokExecutable = process.platform === "win32" ? "ngrok.exe" : "ngrok";
const childEnvironment = { ...process.env };
const requestedFlags = new Set(process.argv.slice(2).filter((argument) => argument !== "--"));
const knownFlags = new Set(["--help", "-h", "--set-menu-button", "--set-webhook"]);

for (const flag of requestedFlags) {
  if (!knownFlags.has(flag)) {
    console.error(`Unknown option: ${flag}`);
    printUsage();
    process.exit(2);
  }
}

if (requestedFlags.has("--help") || requestedFlags.has("-h")) {
  printUsage();
  process.exit(0);
}

if (!existsSync(localEnvFile)) {
  fail("Missing .env.local. Copy .env.local.example to .env.local first.");
}

if (!existsSync(ngrokConfigFile)) {
  fail("Missing ngrok.local.yml.");
}

process.loadEnvFile(localEnvFile);
Object.assign(childEnvironment, process.env);

if (process.platform !== "win32") {
  const localTempDirectory = "/tmp/football-bot-ngrok";
  mkdirSync(localTempDirectory, { recursive: true });
  childEnvironment.TMPDIR = localTempDirectory;
  childEnvironment.TMP = localTempDirectory;
  childEnvironment.TEMP = localTempDirectory;
}

const requiredEnvironment = [
  "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_OWNER_USER_ID",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_CHAT_TOPIC_ID",
  "TELEGRAM_GENERAL_TOPIC_ID",
];

for (const name of requiredEnvironment) {
  if (process.env[name]?.trim() === undefined || process.env[name]?.trim() === "") {
    fail(`Missing ${name} in .env.local.`);
  }
}

const children = new Set();
let stopping = false;

function printUsage() {
  console.info(`Usage:
  pnpm dev
  pnpm dev -- --set-menu-button
  pnpm dev -- --set-webhook

The default command opens API and Web ngrok tunnels and starts the API and Vite
processes with the public URLs. Start local PostgreSQL and apply migrations
separately before running this command.

Options:
  --set-menu-button   Set the owner's Telegram menu button to the public Web URL.
  --set-webhook       Register the local poll-only Telegram webhook for this run.
`);
}

function fail(message) {
  console.error(`ngrok development setup failed: ${message}`);
  process.exit(1);
}

function findGlobalNgrokConfig() {
  const result = spawnSync(ngrokExecutable, ["config", "check"], {
    cwd: projectRoot,
    env: childEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/Valid configuration file at (.+)$/m);
  const configPath = match?.[1]?.trim();
  return configPath !== undefined && existsSync(configPath) ? configPath : undefined;
}

function startChild(command, argumentsToRun, environment = childEnvironment) {
  const child = spawn(command, argumentsToRun, {
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

async function readNgrokTunnels() {
  const response = await fetch("http://127.0.0.1:4040/api/tunnels");
  if (!response.ok) throw new Error(`ngrok API returned HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.tunnels) ? payload.tunnels : [];
}

async function waitForTunnels(ngrokProcess) {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    if (ngrokProcess.exitCode !== null || ngrokProcess.signalCode !== null) {
      throw new Error(
        "ngrok exited before opening the tunnels. Authenticate it locally with 'ngrok config add-authtoken <token>' and retry.",
      );
    }

    try {
      const tunnels = await readNgrokTunnels();
      const apiTunnel = tunnels.find((tunnel) => tunnel.name === "football-api");
      const webTunnel = tunnels.find((tunnel) => tunnel.name === "football-web");
      const apiUrl = apiTunnel?.public_url;
      const webUrl = webTunnel?.public_url;

      if (typeof apiUrl === "string" && typeof webUrl === "string") {
        return { apiUrl, webUrl };
      }
    } catch (error) {
      lastError = error;
    }

    await wait(250);
  }

  throw new Error(
    `Timed out waiting for ngrok tunnels${lastError instanceof Error ? `: ${lastError.message}` : "."}`,
  );
}

async function waitForHttp(url, label) {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const statusCode = await new Promise((resolveStatus, rejectStatus) => {
        const request = getHttp(url, (response) => {
          response.resume();
          resolveStatus(response.statusCode ?? 0);
        });
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

async function telegramApi(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? `HTTP ${response.status}`}`);
  }

  return payload.result;
}

async function main() {
  const ngrokArguments = ["start", "--all"];
  const globalNgrokConfig = findGlobalNgrokConfig();
  if (globalNgrokConfig !== undefined) {
    ngrokArguments.push("--config", globalNgrokConfig);
  }
  ngrokArguments.push("--config", ngrokConfigFile);

  const ngrok = startChild(ngrokExecutable, ngrokArguments);
  const { apiUrl, webUrl } = await waitForTunnels(ngrok);

  const apiEnvironment = {
    ...childEnvironment,
    TELEGRAM_MINI_APP_URL: webUrl,
    WEB_ORIGIN: webUrl,
  };
  const webEnvironment = {
    ...childEnvironment,
    VITE_API_BASE_URL: webUrl,
    VITE_API_PROXY_TARGET: "http://127.0.0.1:6000",
    VITE_PUBLIC_HOST: new URL(webUrl).hostname,
  };

  startChild(packageManager, ["--filter", "@football/api", "exec", "tsx", "src/main.ts"], apiEnvironment);
  startChild(packageManager, ["--filter", "@football/web", "dev", "--host", "127.0.0.1"], webEnvironment);

  await Promise.all([
    waitForHttp("http://127.0.0.1:6000/health", "the local API"),
    waitForHttp("http://127.0.0.1:6173/", "the local Web app"),
  ]);

  console.info(`\nLocal Telegram development is ready.
  Mini App: ${webUrl}
  API:      ${apiUrl}
  ngrok UI: http://127.0.0.1:4040

Open the Mini App from the local bot using the Mini App URL above.
`);

  if (requestedFlags.has("--set-menu-button")) {
    await telegramApi("setChatMenuButton", {
      chat_id: process.env.TELEGRAM_OWNER_USER_ID,
      menu_button: {
        type: "web_app",
        text: "Football Bot",
        web_app: { url: webUrl },
      },
    });
    console.info("The owner's local Telegram menu button was configured.");
  }

  if (requestedFlags.has("--set-webhook")) {
    const secretToken = createHash("sha256")
      .update(`football-bot-poll-webhook:${process.env.TELEGRAM_BOT_TOKEN}`, "utf8")
      .digest("hex");
    await telegramApi("setWebhook", {
      url: `${apiUrl}/v1/telegram/webhook`,
      secret_token: secretToken,
      allowed_updates: ["poll"],
    });
    console.info("The local poll-only Telegram webhook was configured.");
  }

  await new Promise(() => {});
  await stopChild(ngrok);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

main().catch(async (error) => {
  console.error(`ngrok development setup failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
});
