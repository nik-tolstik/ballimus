import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

let child;
let restartTimer;
let restartInProgress = false;
let stopping = false;

function startChild() {
  const nextChild = spawn(
    packageManager,
    ["exec", "tsx", "watch", "--clear-screen=false", "--env-file=.env", "src/main.ts"],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  child = nextChild;
  nextChild.once("exit", (code, signal) => {
    if (child === nextChild) child = undefined;
    if (stopping || restartInProgress) return;

    const reason = signal === null ? `exit code ${code ?? 1}` : `signal ${signal}`;
    console.error(`Development bot process stopped (${reason}).`);
    process.exitCode = code ?? 1;
  });
}

function stopChild() {
  const currentChild = child;
  if (currentChild === undefined) return Promise.resolve();

  return new Promise((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveStop();
    };

    currentChild.once("exit", finish);
    currentChild.kill("SIGTERM");

    const forceKillTimer = setTimeout(() => {
      if (!settled) currentChild.kill("SIGKILL");
    }, 5000);
    forceKillTimer.unref();
  });
}

async function restartChild() {
  if (stopping || restartInProgress) return;
  restartInProgress = true;

  try {
    await stopChild();
    if (!stopping) startChild();
  } finally {
    restartInProgress = false;
  }
}

function scheduleRestart() {
  if (restartTimer !== undefined) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void restartChild();
  }, 100);
  restartTimer.unref();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (restartTimer !== undefined) clearTimeout(restartTimer);
  environmentWatcher.close();
  await stopChild();
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

console.info("Development watcher started. Source and .env changes restart the bot automatically.");
startChild();
