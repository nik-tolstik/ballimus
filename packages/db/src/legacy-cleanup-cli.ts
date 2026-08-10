import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createDatabaseClient } from "./client.js";
import { cleanupDeliveredLegacyCardDeletions } from "./legacy-cleanup.js";

const rootLocalEnvironment = resolve(import.meta.dirname, "../../../.env.local");

async function main(): Promise<void> {
  if (process.env["DATABASE_URL"] === undefined && existsSync(rootLocalEnvironment)) {
    process.loadEnvFile(rootLocalEnvironment);
  }
  const client = createDatabaseClient({ maxConnections: 1 });
  try {
    console.info(JSON.stringify({ removed: await cleanupDeliveredLegacyCardDeletions(client.db) }));
  } finally {
    await client.close();
  }
}

void main().catch(() => {
  console.error("Legacy card cleanup failed.");
  process.exitCode = 1;
});
