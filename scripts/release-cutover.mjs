#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { loadProductionConfig, parseProductionCutoverConfig } from "./production-release-config.mjs";
import {
  evaluateHealth,
  evaluateMigrationStatus,
  evaluateRailwayServices,
  parseJsonOutput,
} from "./verify-production.mjs";

const executeFile = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const confirmationFlag = "--confirm-production-cutover";

export function createCutoverPlan(config) {
  const railwayArguments = ["exec", "railway"];
  const serviceArguments = ["-p", config.railwayProjectId, "-e", config.railwayEnvironment];
  const scale = (service) => [
    ...railwayArguments,
    "service",
    "scale",
    ...serviceArguments,
    "-s",
    service,
    `${config.railwayRegionAlias}=0`,
  ];
  const deploy = (service) => [
    ...railwayArguments,
    "up",
    ".",
    "--path-as-root",
    "--ci",
    ...serviceArguments,
    "-s",
    service,
  ];
  return [
    { name: "Stop Railway API", argumentsToRun: scale(config.railwayApiService) },
    { name: "Stop Railway jobs", argumentsToRun: scale(config.railwayJobsService) },
    { name: "Deploy Railway API and migrations", argumentsToRun: deploy(config.railwayApiService) },
    { name: "Deploy Railway jobs", argumentsToRun: deploy(config.railwayJobsService) },
  ];
}

export function cutoverIsConfirmed(argumentsToParse) {
  return argumentsToParse.includes(confirmationFlag);
}

async function runCommand(command, argumentsToRun, timeout = 30_000) {
  try {
    const { stdout } = await executeFile(command, argumentsToRun, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    throw new Error(`${command} command failed`);
  }
}

async function fetchProduction(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("Production HTTP request failed");
  }
}

async function committedMigrationCount() {
  const directory = resolve(projectRoot, "packages/db/migrations");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /^\d+_.+\.sql$/u.test(entry.name)).length;
}

async function verifyRailwayCutover(config) {
  const serviceStatus = parseJsonOutput(await runCommand("pnpm", [
    "exec", "railway", "service", "status", "--all", "--json", "-p", config.railwayProjectId,
    "-e", config.railwayEnvironment,
  ]), "Railway services");
  const services = evaluateRailwayServices(serviceStatus, config.railwayApiService, config.railwayJobsService);
  if (!services.ok) throw new Error(services.summary);

  const healthResponse = await fetchProduction(`${config.apiUrl}/health`);
  const health = evaluateHealth(await healthResponse.json());
  if (!health.ok) throw new Error(health.summary);

  const migrationStatus = parseJsonOutput(await runCommand("pnpm", [
    "exec", "railway", "ssh", "-p", config.railwayProjectId, "-e", config.railwayEnvironment,
    "-s", config.railwayApiService, "--", "node", "packages/db/dist/migration-status-cli.js",
  ]), "Migration status");
  const migrations = evaluateMigrationStatus(migrationStatus, await committedMigrationCount());
  if (!migrations.ok) throw new Error(migrations.summary);
}

async function main() {
  if (!cutoverIsConfirmed(process.argv.slice(2))) {
    throw new Error(`Refusing to change production without ${confirmationFlag}`);
  }

  const preflight = await runCommand("pnpm", ["release:preflight"]);
  if (preflight !== "") process.stdout.write(`${preflight}\n`);

  const config = await loadProductionConfig(parseProductionCutoverConfig, projectRoot);
  for (const step of createCutoverPlan(config)) {
    console.info(`RUN ${step.name}`);
    await runCommand("pnpm", step.argumentsToRun, 15 * 60_000);
    console.info(`PASS ${step.name}`);
  }

  await verifyRailwayCutover(config);
  console.info("PASS Railway API health, services, and database migrations");
  console.info("Railway cutover completed. Deploy the exact checked-out main commit to Vercel production, then run pnpm release:verify-production.");
}

const runsDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);

if (runsDirectly) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.info(`Usage: pnpm release:cutover -- ${confirmationFlag}`);
    console.info("Stops Railway services, deploys API before jobs, and verifies Railway. It never deploys Vercel or changes Telegram.");
  } else {
    void main().catch((error) => {
      const message = error instanceof Error ? error.message : "Production cutover could not start";
      console.error(`FAIL production cutover: ${message}`);
      process.exitCode = 1;
    });
  }
}
