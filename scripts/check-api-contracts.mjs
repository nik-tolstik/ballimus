#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(argumentsToRun, environment) {
  const result = spawnSync(packageManager, argumentsToRun, {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${packageManager} ${argumentsToRun.join(" ")} exited with code ${result.status ?? 1}`);
}

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

async function compareFile(expected, actual, label) {
  const [expectedValue, actualValue] = await Promise.all([readFile(expected), readFile(actual)]);
  if (!expectedValue.equals(actualValue)) throw new Error(`${label} is stale; run pnpm openapi:generate && pnpm api-client:generate`);
}

async function compareDirectories(expectedRoot, actualRoot) {
  const [expectedFiles, actualFiles] = await Promise.all([filesBelow(expectedRoot), filesBelow(actualRoot)]);
  const expectedRelative = expectedFiles.map((file) => relative(expectedRoot, file)).sort();
  const actualRelative = actualFiles.map((file) => relative(actualRoot, file)).sort();
  if (JSON.stringify(expectedRelative) !== JSON.stringify(actualRelative)) {
    throw new Error("Generated API client file set is stale; run pnpm openapi:generate && pnpm api-client:generate");
  }
  for (const path of expectedRelative) {
    await compareFile(join(expectedRoot, path), join(actualRoot, path), `Generated API client file ${path}`);
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "football-contracts-"));
try {
  const temporaryOpenApi = join(temporaryRoot, "openapi.json");
  const temporaryGenerated = join(temporaryRoot, "generated");
  run(["--filter", "@football/api", "run", "openapi:write"], {
    OPENAPI_OUTPUT: temporaryOpenApi,
  });
  run(["--filter", "@football/api-client", "exec", "orval", "--config", "orval.config.ts"], {
    ORVAL_INPUT: temporaryOpenApi,
    ORVAL_OUTPUT: temporaryGenerated,
    ORVAL_SCHEMAS: join(temporaryGenerated, "model"),
  });
  run(["exec", "node", "packages/api-client/scripts/normalize-generated-imports.mjs"], {
    GENERATED_ROOT: temporaryGenerated,
  });
  await compareFile(join(projectRoot, "apps/api/openapi.json"), temporaryOpenApi, "OpenAPI document");
  await compareDirectories(join(projectRoot, "packages/api-client/src/generated"), temporaryGenerated);
  console.info("OpenAPI and generated API client are reproducible.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
