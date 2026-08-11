#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { get as getHttp } from "node:http";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvFile = resolve(projectRoot, ".env.local");
const fixtureScript = resolve(projectRoot, "scripts/generate-init-data.mjs");
const tsxRunner = resolve(projectRoot, "scripts/run-tsx.mjs");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const localWebUrl = "http://127.0.0.1:6173";
const childEnvironment = { ...process.env };
const children = new Set();
let stopping = false;

function fail(message) {
  console.error(`browser development setup failed: ${message}`);
  process.exit(1);
}

function startChild(command, argumentsToRun, environment) {
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

function createLocalOwnerFixture() {
  const result = spawnSync(process.execPath, [fixtureScript], {
    cwd: projectRoot,
    encoding: "utf8",
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const fixture = result.stdout.trim();
  if (result.status !== 0 || fixture === "") {
    const reason = result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
    fail(`could not create the local owner session: ${reason}`);
  }

  return fixture;
}

async function main() {
  if (!existsSync(localEnvFile)) fail("Missing .env.local. Copy .env.local.example to .env.local first.");

  process.loadEnvFile(localEnvFile);
  Object.assign(childEnvironment, process.env);
  const localOwnerFixture = createLocalOwnerFixture();
  const apiEnvironment = {
    ...childEnvironment,
    TELEGRAM_MINI_APP_URL: localWebUrl,
    WEB_ORIGIN: localWebUrl,
  };
  const webEnvironment = {
    ...childEnvironment,
    VITE_API_BASE_URL: localWebUrl,
    VITE_API_PROXY_TARGET: "http://127.0.0.1:6000",
    VITE_LOCAL_OWNER_INIT_DATA: localOwnerFixture,
  };

  startChild(process.execPath, [tsxRunner, "--tsconfig", "apps/api/tsconfig.json", "apps/api/src/main.ts"], apiEnvironment);
  startChild(packageManager, ["--filter", "@football/web", "dev", "--host", "127.0.0.1"], webEnvironment);

  await Promise.all([
    waitForHttp("http://127.0.0.1:6000/health", "the local API"),
    waitForHttp(`${localWebUrl}/`, "the local Web app"),
  ]);

  console.info(`\nLocal browser development is ready.\n  Web: ${localWebUrl}\n  API: http://127.0.0.1:6000\n\nThe signed local owner session is held only by the loopback Vite process. The public Cloudflare Tunnel route is not used.\n`);
  await new Promise(() => {});
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

main().catch(async (error) => {
  console.error(`browser development setup failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
});
