import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { readMigrationStatus } from "./migration-status.js";

const rootLocalEnvironment = resolve(import.meta.dirname, "../../../.env.local");

async function main(): Promise<void> {
  if (process.env["DATABASE_URL"] === undefined && existsSync(rootLocalEnvironment)) {
    process.loadEnvFile(rootLocalEnvironment);
  }
  console.info(JSON.stringify(await readMigrationStatus()));
}

void main().catch(() => {
  console.error("Migration status check failed.");
  process.exitCode = 1;
});
