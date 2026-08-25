import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { AppDatabase } from "../client.js";
import { schema } from "../schema.js";

const defaultLocalDatabaseUrl =
  "postgresql://football_local:football_local_dev_password@127.0.0.1:55432/football_local";
const migrationsFolder = resolve(import.meta.dirname, "../../migrations");
const applicationName = "football-bot-postgres-integration-tests";

const applicationTables = [
  "matches",
  "match_messages",
  "telegram_poll_vote_events",
  "telegram_poll_voter_answers",
  "telegram_polls",
  "http_idempotency_keys",
  "outbox",
  "job_claims",
  "venues",
] as const;

export interface PostgresTestDatabase {
  readonly db: AppDatabase;
  readonly sql: ReturnType<typeof postgres>;
  readonly schemaName: string;
  readonly migrationSchemaName: string;
  close(): Promise<void>;
}

function localDatabaseUrl(): string {
  const configuredUrl = process.env["DATABASE_URL"]?.trim();
  const url = configuredUrl === undefined || configuredUrl === "" ? defaultLocalDatabaseUrl : configuredUrl;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error("PostgreSQL integration tests require a valid local DATABASE_URL", { cause: error });
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      `Refusing PostgreSQL integration tests for non-local host ${parsed.hostname}; use the loopback DATABASE_URL from docs/local-postgres.md`,
    );
  }
  return url;
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`Unsafe PostgreSQL test identifier: ${value}`);
  return `"${value}"`;
}

async function dropSchemas(url: string, schemaName: string, migrationSchemaName: string): Promise<void> {
  const cleanup = postgres(url, {
    max: 1,
    connect_timeout: 5,
    connection: { application_name: applicationName },
  });
  try {
    await cleanup.unsafe(`drop schema if exists ${quotedIdentifier(migrationSchemaName)} cascade`);
    await cleanup.unsafe(`drop schema if exists ${quotedIdentifier(schemaName)} cascade`);
  } finally {
    await cleanup.end({ timeout: 5 });
  }
}

/** Creates a unique schema and applies the real repository baseline migration to it. */
export async function createPostgresTestDatabase(): Promise<PostgresTestDatabase> {
  const url = localDatabaseUrl();
  const suffix = randomUUID().replaceAll("-", "");
  const schemaName = `football_test_${process.pid}_${suffix}`;
  const migrationSchemaName = `drizzle_test_${process.pid}_${suffix}`;
  const admin = postgres(url, {
    max: 1,
    connect_timeout: 5,
    connection: { application_name: applicationName },
  });

  try {
    await admin.unsafe(`create schema ${quotedIdentifier(schemaName)}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const sql = postgres(url, {
    max: 8,
    connect_timeout: 5,
    connection: {
      application_name: applicationName,
      search_path: schemaName,
    },
  });
  const db = drizzle(sql, { schema });

  try {
    await migrate(db, { migrationsFolder, migrationsSchema: migrationSchemaName });
  } catch (error) {
    await sql.end({ timeout: 5 });
    await dropSchemas(url, schemaName, migrationSchemaName);
    throw new Error(
      "PostgreSQL integration tests could not apply the fresh baseline migration; run `node scripts/postgres-local.mjs up` and verify the local DATABASE_URL",
      { cause: error },
    );
  }

  let closed = false;
  return {
    db,
    sql,
    schemaName,
    migrationSchemaName,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await sql.end({ timeout: 5 });
      await dropSchemas(url, schemaName, migrationSchemaName);
    },
  };
}

/** Clears only application rows in the unique test schema and preserves the migration ledger. */
export async function resetPostgresTestDatabase(database: PostgresTestDatabase): Promise<void> {
  const tableNames = applicationTables.map(quotedIdentifier).join(", ");
  await database.sql.unsafe(`truncate table ${tableNames} restart identity cascade`);
}
