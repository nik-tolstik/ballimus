#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { loadProductionConfig, parseProductionCutoverConfig } from "./production-release-config.mjs";

const executeFile = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

export function evaluateRailwayCliVersion(output) {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/u.exec(output);
  if (match?.[1] === undefined) return { ok: false, summary: "Railway CLI did not report a semantic version" };
  if (Number(match[1]) !== 5) return { ok: false, summary: "Railway CLI major version must be 5" };
  return { ok: true, summary: `Railway CLI v${match[0]} is pinned locally` };
}

export function evaluateReleaseCheckout(branch, worktreeStatus, headSha, mainSha) {
  if (branch !== "main") return { ok: false, summary: "Release checkout must be on main" };
  if (worktreeStatus !== "") return { ok: false, summary: "Release checkout has uncommitted changes" };
  if (headSha !== mainSha) return { ok: false, summary: "Release checkout does not match origin/main" };
  return { ok: true, summary: `Release checkout matches origin/main (${headSha.slice(0, 12)})` };
}

async function runCommand(command, argumentsToRun) {
  try {
    const { stdout } = await executeFile(command, argumentsToRun, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    throw new Error(`${command} command failed`);
  }
}

export async function runReleasePreflight() {
  const config = await loadProductionConfig(parseProductionCutoverConfig, projectRoot);
  await runCommand("git", ["fetch", "--quiet", "origin", "main"]);

  const [branch, worktreeStatus, headSha, mainSha, railwayVersion] = await Promise.all([
    runCommand("git", ["branch", "--show-current"]),
    runCommand("git", ["status", "--porcelain"]),
    runCommand("git", ["rev-parse", "HEAD"]),
    runCommand("git", ["rev-parse", "origin/main"]),
    runCommand("pnpm", ["exec", "railway", "--version"]),
  ]);

  const checks = [
    {
      name: "Railway region alias",
      ok: true,
      summary: `Using the supported ${config.railwayRegionAlias} alias for scaling`,
    },
    { name: "Railway CLI", ...evaluateRailwayCliVersion(railwayVersion) },
    { name: "Release checkout", ...evaluateReleaseCheckout(branch, worktreeStatus, headSha, mainSha) },
  ];
  for (const check of checks) {
    console.info(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.summary}`);
  }
  return checks.every((check) => check.ok);
}

const runsDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);

if (runsDirectly) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.info("Usage: pnpm release:preflight");
    console.info("Validates the committed main checkout, Railway CLI v5, and the safe Railway region alias.");
  } else {
    void runReleasePreflight().then(
      (passed) => { if (!passed) process.exitCode = 1; },
      (error) => {
        const message = error instanceof Error ? error.message : "Production release preflight could not start";
        console.error(`FAIL production release preflight: ${message}`);
        process.exitCode = 1;
      },
    );
  }
}
