import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const apiRoot = resolve(projectRoot, "apps/api");
const webRoot = resolve(projectRoot, "apps/web");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  process.loadEnvFile(resolve(projectRoot, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const children = new Set();
let restartTimer;
let restartInProgress = false;
let stopping = false;

function startApi() {
  const nextChild = spawn(
    packageManager,
    ["exec", "tsx", "watch", "--clear-screen=false", "--env-file=../../.env", "src/main.ts"],
    {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  children.add(nextChild);
  nextChild.once("exit", (code, signal) => {
    children.delete(nextChild);
    if (stopping || restartInProgress) return;

    const reason = signal === null ? `exit code ${code ?? 1}` : `signal ${signal}`;
    console.error(`Development API process stopped (${reason}).`);
    process.exitCode = code ?? 1;
  });
}

function startWeb() {
  const nextChild = spawn(packageManager, ["exec", "vite"], {
    cwd: webRoot,
    env: process.env,
    stdio: "inherit",
  });

  children.add(nextChild);
  nextChild.once("exit", (code, signal) => {
    children.delete(nextChild);
    if (stopping) return;

    const reason = signal === null ? `exit code ${code ?? 1}` : `signal ${signal}`;
    console.error(`Development web process stopped (${reason}).`);
    process.exitCode = code ?? 1;
  });
}

function stopChild(child) {
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

async function restartApi() {
  if (stopping || restartInProgress) return;
  restartInProgress = true;

  try {
    const apiChild = [...children].find((child) => child.spawnargs.includes("src/main.ts"));
    if (apiChild !== undefined) await stopChild(apiChild);
    if (!stopping) startApi();
  } finally {
    restartInProgress = false;
  }
}

function scheduleRestart() {
  if (restartTimer !== undefined) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void restartApi();
  }, 100);
  restartTimer.unref();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (restartTimer !== undefined) clearTimeout(restartTimer);
  environmentWatcher.close();
  await Promise.all([...children].map((child) => stopChild(child)));
}

const environmentWatcher = watch(projectRoot, (_eventType, filename) => {
  if (filename?.toString() === ".env") scheduleRestart();
});

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(143));
});

console.info("Development API and web workflows started. API and .env changes restart the API automatically.");
startApi();
startWeb();
