#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const composeFile = resolve(projectRoot, "docker-compose.yml");
const localEnvFile = resolve(projectRoot, ".env.local");
const exampleEnvFile = resolve(projectRoot, ".env.local.example");
const envFile = existsSync(localEnvFile) ? localEnvFile : exampleEnvFile;
const dockerExecutable = process.platform === "win32" ? "docker.exe" : "docker";
const [command = "up", ...commandArguments] = process.argv.slice(2);

const composeArguments = [
  "compose",
  "--project-name",
  "football-bot-local",
  "--file",
  composeFile,
  "--env-file",
  envFile,
];

const lifecycleCommands = new Map([
  ["up", ["up", "--detach", "--wait"]],
  ["start", ["up", "--detach", "--wait"]],
  ["stop", ["stop"]],
  ["down", ["down", "--remove-orphans"]],
  ["status", ["ps"]],
  ["logs", ["logs", "--tail=100", "--follow"]],
]);

function printUsage() {
  console.info(`Usage: node scripts/postgres-local.mjs [command]

Commands:
  up       Start PostgreSQL and wait for its healthcheck (default)
  start    Alias for up
  stop     Stop the container without removing its data volume
  down     Remove the container and network without removing its data volume
  status   Show container status and health
  logs     Follow the latest PostgreSQL logs
  reset    Delete the local database volume; requires --confirm-reset
`);
}

function refuseUnexpectedArguments() {
  if (commandArguments.length === 0) return false;

  console.error(`Unexpected argument(s) for '${command}'.`);
  printUsage();
  process.exitCode = 2;
  return true;
}

function runCompose(argumentsToRun) {
  const result = spawnSync(dockerExecutable, [...composeArguments, ...argumentsToRun], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Unable to run Docker Compose: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 1;
}

if (command === "help" || command === "--help" || command === "-h") {
  printUsage();
} else if (command === "reset") {
  if (commandArguments.length !== 1 || commandArguments[0] !== "--confirm-reset") {
    console.error(
      "Refusing to delete the local PostgreSQL volume. Re-run exactly as 'reset --confirm-reset' when data deletion is intended.",
    );
    process.exitCode = 2;
  } else {
    runCompose(["down", "--volumes", "--remove-orphans"]);
  }
} else if (lifecycleCommands.has(command)) {
  if (!refuseUnexpectedArguments()) {
    runCompose(lifecycleCommands.get(command));
  }
} else {
  console.error(`Unknown command '${command}'.`);
  printUsage();
  process.exitCode = 2;
}
