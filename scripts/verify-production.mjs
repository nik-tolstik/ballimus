#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

import {
  loadProductionConfig,
  parsePublicProductionConfig,
  validatePublicProductionConfig,
} from "./production-release-config.mjs";

const executeFile = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { parsePublicProductionConfig, validatePublicProductionConfig };

export function parseGitHubRepository(remoteUrl) {
  const normalized = remoteUrl.trim().replace(/\.git$/u, "");
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+)\/([^/]+)$/u.exec(normalized);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("origin must point to a GitHub repository");
  }
  return `${match[1]}/${match[2]}`;
}

export function evaluateGitHubCi(runs, expectedSha) {
  if (!Array.isArray(runs)) return { ok: false, summary: "GitHub CI response was invalid" };
  const latestCi = runs.find((run) => isRecord(run) && run.workflowName === "CI");
  if (!isRecord(latestCi)) return { ok: false, summary: "No CI run was found for main" };
  if (latestCi.headSha !== expectedSha) return { ok: false, summary: "Latest CI does not match origin/main" };
  if (latestCi.status !== "completed" || latestCi.conclusion !== "success") {
    return { ok: false, summary: "Latest CI for origin/main is not successful" };
  }
  return { ok: true, summary: `CI passed for ${expectedSha.slice(0, 12)}` };
}

export function evaluateVercelStatus(statusResponse) {
  if (!isRecord(statusResponse) || !Array.isArray(statusResponse.statuses)) {
    return { ok: false, summary: "GitHub deployment status response was invalid" };
  }
  const vercelStatus = statusResponse.statuses.find((status) =>
    isRecord(status) && typeof status.context === "string" && status.context.toLowerCase() === "vercel",
  );
  if (!isRecord(vercelStatus)) return { ok: false, summary: "No Vercel GitHub status was found" };
  if (vercelStatus.state !== "success") return { ok: false, summary: "Vercel GitHub status is not successful" };
  return { ok: true, summary: "Vercel GitHub status passed" };
}

export function evaluateRailwayServices(services, apiService, jobsService) {
  if (!Array.isArray(services)) return { ok: false, summary: "Railway service status response was invalid" };
  const api = services.find((service) => isRecord(service) && service.name === apiService);
  const jobs = services.find((service) => isRecord(service) && service.name === jobsService);
  if (!isRecord(api) || api.status !== "SUCCESS" || api.stopped !== false) {
    return { ok: false, summary: "Railway API is not running successfully" };
  }
  if (!isRecord(jobs) || jobs.status !== "SUCCESS") {
    return { ok: false, summary: "Railway Jobs has not completed successfully" };
  }
  return { ok: true, summary: "Railway API and Jobs are successful" };
}

export function evaluateHealth(response) {
  if (!isRecord(response) || response.status !== "ok" || response.service !== "api") {
    return { ok: false, summary: "Production API health response was invalid" };
  }
  return { ok: true, summary: "Production API health passed" };
}

export function evaluateCors(response, expectedOrigin) {
  const origin = response.headers.get("access-control-allow-origin");
  const methods = response.headers.get("access-control-allow-methods") ?? "";
  const allowsGet = methods.split(",").map((value) => value.trim()).includes("GET");
  if (response.status !== 204 || origin !== expectedOrigin || !allowsGet) {
    return { ok: false, summary: "Production API CORS does not allow the exact web origin" };
  }
  return { ok: true, summary: "Production API CORS passed" };
}

export function evaluateMigrationStatus(status, expectedMigrationCount) {
  if (!isRecord(status)) return { ok: false, summary: "Migration status response was invalid" };
  if (status.migrationLedgerPresent !== true || status.schemaPresent !== true) {
    return { ok: false, summary: "Production database schema is incomplete" };
  }
  if (status.appliedMigrationCount !== expectedMigrationCount) {
    return { ok: false, summary: "Production database migration ledger does not match committed migrations" };
  }
  return { ok: true, summary: `Production database has ${expectedMigrationCount} committed migrations` };
}

export function evaluateTelegramWebhookStatus(status) {
  if (
    !isRecord(status)
    || typeof status.url !== "string"
    || !Number.isSafeInteger(status.pendingUpdateCount)
    || status.pendingUpdateCount < 0
  ) {
    return { ok: false, summary: "Telegram webhook status response was invalid" };
  }
  if (status.url !== "") return { ok: false, summary: "Telegram webhook is still configured" };
  return { ok: true, summary: `Telegram webhook is disabled (pending updates: ${status.pendingUpdateCount})` };
}

export function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output.trim());
  } catch {
    // Some commands prepend diagnostics before a single-line JSON payload.
  }
  for (const line of output.trim().split(/\r?\n/u).reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  throw new Error(`${label} did not return JSON`);
}

async function runCommand(command, argumentsToRun, environment = {}) {
  try {
    const { stdout } = await executeFile(command, argumentsToRun, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ...environment },
    });
    return stdout;
  } catch {
    throw new Error(`${command} command failed`);
  }
}

async function fetchProduction(url, init = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("Production HTTP request failed");
  }
}

async function committedMigrationCount() {
  const directory = resolve(projectRoot, "packages/db/migrations");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /^\d+_.+\.sql$/u.test(entry.name)).length;
}

async function loadConfig() {
  return loadProductionConfig(parsePublicProductionConfig, projectRoot);
}

function result(name, check) {
  return check().then(
    (value) => ({ name, ...value }),
    () => ({ name, ok: false, summary: "check could not be completed" }),
  );
}

async function main() {
  const config = await loadConfig();
  await runCommand("git", ["fetch", "--quiet", "origin", "main"]);
  const mainShaResult = await result("origin/main", async () => ({
    ok: true,
    summary: (await runCommand("git", ["rev-parse", "origin/main"])).trim(),
  }));
  const repositoryResult = await result("GitHub repository", async () => ({
    ok: true,
    summary: parseGitHubRepository(await runCommand("git", ["remote", "get-url", "origin"])),
  }));
  const mainSha = mainShaResult.ok ? mainShaResult.summary : undefined;
  const repository = repositoryResult.ok ? repositoryResult.summary : undefined;

  const checks = [mainShaResult, repositoryResult];
  checks.push(await result("GitHub CI", async () => {
    if (mainSha === undefined || repository === undefined) throw new Error("GitHub prerequisites failed");
    const runs = parseJsonOutput(await runCommand("gh", [
      "run", "list", "--repo", repository, "--branch", "main", "--workflow", "CI", "--limit", "20",
      "--json", "workflowName,status,conclusion,headSha,url",
    ]), "GitHub CI");
    return evaluateGitHubCi(runs, mainSha);
  }));
  checks.push(await result("Vercel GitHub status", async () => {
    if (mainSha === undefined || repository === undefined) throw new Error("GitHub prerequisites failed");
    const status = parseJsonOutput(await runCommand("gh", ["api", `repos/${repository}/commits/${mainSha}/status`]), "Vercel status");
    return evaluateVercelStatus(status);
  }));
  checks.push(await result("Vercel production URL", async () => {
    const response = await fetchProduction(config.webUrl);
    return response.ok
      ? { ok: true, summary: "Vercel production URL passed" }
      : { ok: false, summary: "Vercel production URL returned an error" };
  }));
  checks.push(await result("Railway services", async () => {
    const services = parseJsonOutput(await runCommand("pnpm", [
      "exec", "railway", "service", "status", "--all", "--json", "--project", config.railwayProjectId,
      "--environment", config.railwayEnvironment,
    ]), "Railway services");
    return evaluateRailwayServices(services, config.railwayApiService, config.railwayJobsService);
  }));
  checks.push(await result("API health", async () => {
    const response = await fetchProduction(`${config.apiUrl}/health`);
    return evaluateHealth(await response.json());
  }));
  checks.push(await result("API CORS", async () => {
    const response = await fetchProduction(`${config.apiUrl}/v1/venues`, {
      method: "OPTIONS",
      headers: {
        Origin: config.webUrl,
        "Access-Control-Request-Method": "GET",
      },
    });
    return evaluateCors(response, config.webUrl);
  }));
  checks.push(await result("Database migrations", async () => {
    const status = parseJsonOutput(await runCommand("pnpm", [
      "exec", "railway", "ssh", "--project", config.railwayProjectId, "--environment", config.railwayEnvironment,
      "--service", config.railwayApiService, "--", "node", "packages/db/dist/migration-status-cli.js",
    ]), "Migration status");
    return evaluateMigrationStatus(status, await committedMigrationCount());
  }));
  checks.push(await result("Telegram webhook", async () => {
    const status = parseJsonOutput(await runCommand("pnpm", [
      "exec", "railway", "ssh", "--project", config.railwayProjectId, "--environment", config.railwayEnvironment,
      "--service", config.railwayApiService, "--", "node", "apps/api/dist/telegram/webhook-status-cli.js",
    ]), "Telegram webhook status");
    return evaluateTelegramWebhookStatus(status);
  }));
  for (const check of checks) {
    console.info(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.summary}`);
  }
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

const runsDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);

if (runsDirectly) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.info("Usage: pnpm release:verify-production");
    console.info("Reads public settings from .env.production.local without changing production state.");
  } else {
    void main().catch((error) => {
      const message = error instanceof Error ? error.message : "Production verification could not start";
      console.error(`FAIL production verifier: ${message}`);
      process.exitCode = 1;
    });
  }
}
