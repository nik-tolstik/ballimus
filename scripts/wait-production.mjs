#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { loadProductionConfig, parsePublicProductionConfig } from "./production-release-config.mjs";
import { parseGitHubRepository, parseJsonOutput } from "./verify-production.mjs";

const executeFile = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const defaultTimeoutMs = 10 * 60_000;
const defaultIntervalMs = 10_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExpectedSha(value) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || !/^[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error("PRODUCTION_VERIFY_SHA or GITHUB_SHA must be a full Git commit SHA");
  }
  return normalized;
}

export function evaluateGitHubCiForSha(runs, expectedSha) {
  if (!Array.isArray(runs)) return { state: "failed", summary: "GitHub CI response was invalid" };
  const run = runs.find((candidate) =>
    isRecord(candidate) && candidate.workflowName === "CI" && candidate.headSha === expectedSha,
  );
  if (!isRecord(run)) return { state: "waiting", summary: "GitHub CI has not started for the production SHA" };
  if (run.status !== "completed") return { state: "waiting", summary: "GitHub CI is still running" };
  if (run.conclusion !== "success") return { state: "failed", summary: `GitHub CI completed with ${run.conclusion}` };
  return { state: "ready", summary: "GitHub CI passed for the production SHA" };
}

export function evaluateVercelForSha(statusResponse) {
  if (!isRecord(statusResponse) || !Array.isArray(statusResponse.statuses)) {
    return { state: "failed", summary: "Vercel GitHub status response was invalid" };
  }
  const status = statusResponse.statuses.find((candidate) =>
    isRecord(candidate) && typeof candidate.context === "string" && candidate.context.toLowerCase() === "vercel",
  );
  if (!isRecord(status)) return { state: "waiting", summary: "Vercel deployment has not started" };
  if (status.state === "success") return { state: "ready", summary: "Vercel deployed the production SHA" };
  if (status.state === "failure" || status.state === "error") {
    return { state: "failed", summary: `Vercel deployment completed with ${status.state}` };
  }
  return { state: "waiting", summary: "Vercel deployment is still running" };
}

export function evaluateRailwayForSha(deployments, expectedSha, serviceName) {
  if (!Array.isArray(deployments)) {
    return { state: "failed", summary: `Railway ${serviceName} deployment response was invalid` };
  }
  const deployment = deployments.find((candidate) =>
    isRecord(candidate) && isRecord(candidate.meta) && candidate.meta.commitHash === expectedSha,
  );
  if (!isRecord(deployment) || typeof deployment.status !== "string") {
    return { state: "waiting", summary: `Railway ${serviceName} has not recorded the production SHA` };
  }
  if (deployment.status === "SUCCESS") {
    return { state: "ready", summary: `Railway ${serviceName} deployed the production SHA` };
  }
  if (deployment.status === "SKIPPED") {
    return { state: "ready", summary: `Railway ${serviceName} skipped unchanged watch paths` };
  }
  if (["FAILED", "CRASHED", "REMOVED"].includes(deployment.status)) {
    return { state: "failed", summary: `Railway ${serviceName} completed with ${deployment.status}` };
  }
  return { state: "waiting", summary: `Railway ${serviceName} is ${deployment.status.toLowerCase()}` };
}

async function runCommand(command, argumentsToRun) {
  const { stdout } = await executeFile(command, argumentsToRun, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function inspectProduction(expectedSha) {
  const config = await loadProductionConfig(parsePublicProductionConfig, projectRoot);
  const repository = parseGitHubRepository(await runCommand("git", ["remote", "get-url", "origin"]));
  const railwayArguments = ["-p", config.railwayProjectId, "-e", config.railwayEnvironment, "--limit", "20", "--json"];
  const [runs, vercelStatus, apiDeployments, jobsDeployments] = await Promise.all([
    runCommand("gh", [
      "run", "list", "--repo", repository, "--branch", "main", "--workflow", "CI", "--limit", "20",
      "--json", "workflowName,status,conclusion,headSha,url",
    ]),
    runCommand("gh", ["api", `repos/${repository}/commits/${expectedSha}/status`]),
    runCommand("pnpm", ["exec", "railway", "deployment", "list", "-s", config.railwayApiService, ...railwayArguments]),
    runCommand("pnpm", ["exec", "railway", "deployment", "list", "-s", config.railwayJobsService, ...railwayArguments]),
  ]);
  return [
    { name: "GitHub CI", ...evaluateGitHubCiForSha(parseJsonOutput(runs, "GitHub CI"), expectedSha) },
    { name: "Vercel", ...evaluateVercelForSha(parseJsonOutput(vercelStatus, "Vercel status")) },
    {
      name: "Railway API",
      ...evaluateRailwayForSha(parseJsonOutput(apiDeployments, "Railway API deployments"), expectedSha, config.railwayApiService),
    },
    {
      name: "Railway jobs",
      ...evaluateRailwayForSha(parseJsonOutput(jobsDeployments, "Railway jobs deployments"), expectedSha, config.railwayJobsService),
    },
  ];
}

export async function waitForProduction({
  expectedSha,
  timeoutMs = defaultTimeoutMs,
  intervalMs = defaultIntervalMs,
  inspect = inspectProduction,
  sleep = (duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration)),
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const checks = await inspect(expectedSha);
    for (const check of checks) console.info(`${check.state.toUpperCase()} ${check.name}: ${check.summary}`);
    const failed = checks.find((check) => check.state === "failed");
    if (failed !== undefined) throw new Error(`${failed.name}: ${failed.summary}`);
    if (checks.every((check) => check.state === "ready")) return;
    await sleep(intervalMs);
  }
  throw new Error(`Production deployments did not become ready within ${Math.round(timeoutMs / 1000)} seconds`);
}

const runsDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);

if (runsDirectly) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.info("Usage: pnpm release:wait-production");
    console.info("Waits for GitHub CI, Vercel, Railway API, and Railway jobs to finish the exact production SHA.");
  } else {
    const expectedSha = parseExpectedSha(process.env.PRODUCTION_VERIFY_SHA ?? process.env.GITHUB_SHA);
    void waitForProduction({ expectedSha }).then(
      () => console.info(`PASS production deployments are ready for ${expectedSha.slice(0, 12)}`),
      (error) => {
        const message = error instanceof Error ? error.message : "Production deployment wait failed";
        console.error(`FAIL production deployment wait: ${message}`);
        process.exitCode = 1;
      },
    );
  }
}
