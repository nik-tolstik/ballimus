import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { schema } from "./schema.js";

export type AppDatabase = PostgresJsDatabase<typeof schema>;
export type PostgresClient = ReturnType<typeof postgres>;

export interface DatabaseClient {
  db: AppDatabase;
  sql: PostgresClient;
  close: () => Promise<void>;
}

export interface CreateDatabaseClientOptions {
  url?: string;
  maxConnections?: number;
}

export function assertPostgresDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("DATABASE_URL is required for the PostgreSQL database package");
  }
  if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
    throw new Error("DATABASE_URL must use the PostgreSQL postgres:// or postgresql:// scheme");
  }
  return url;
}

export function createDatabaseClient(options: CreateDatabaseClientOptions = {}): DatabaseClient {
  const url = assertPostgresDatabaseUrl(options.url ?? process.env["DATABASE_URL"]);
  const sql = postgres(url, {
    max: options.maxConnections ?? 10,
  });
  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
