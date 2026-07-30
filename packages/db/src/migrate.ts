import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolve } from "node:path";

import { assertPostgresDatabaseUrl } from "./client.js";

const migrationsFolder = resolve(import.meta.dirname, "../migrations");

async function main(): Promise<void> {
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
