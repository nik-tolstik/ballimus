import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolve } from "node:path";

import { assertPostgresDatabaseUrl } from "./client.js";

const migrationsFolder = resolve(import.meta.dirname, "../migrations");
const rootLocalEnvironment = resolve(import.meta.dirname, "../../../.env.local");

async function main(): Promise<void> {
  if (process.env["DATABASE_URL"] === undefined && existsSync(rootLocalEnvironment)) {
    process.loadEnvFile(rootLocalEnvironment);
  }
  const url = assertPostgresDatabaseUrl(process.env["DATABASE_URL"]);
  const sql = postgres(url, { max: 1 });

  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
