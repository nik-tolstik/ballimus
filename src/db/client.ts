import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import * as schema from "./schema.js";

const defaultDatabaseUrl = "file:./data/football-bot.db";
const defaultMigrationsFolder = resolve(process.cwd(), "drizzle");

export interface DatabaseClientOptions {
  /** A filesystem path, :memory:, or a file: URL from DATABASE_URL. */
  url?: string;
  /** Alias for url, useful when constructing isolated test databases. */
  filename?: string;
  migrationsFolder?: string;
  migrate?: boolean;
}

export interface DatabaseClient {
  db: AppDatabase;
  sqlite: Database.Database;
  close: () => void;
}

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

function sqliteFilename(url: string): string {
  if (url === ":memory:" || url.startsWith("file::memory:")) {
    return url;
  }

  if (!url.startsWith("file:")) {
    return url;
  }

  const path = url.slice("file:".length);
  const queryStart = path.indexOf("?");
  return queryStart === -1 ? path : path.slice(0, queryStart);
}

function ensureParentDirectory(filename: string): void {
  if (filename === ":memory:" || filename.startsWith("file::memory:")) {
    return;
  }

  const parent = dirname(resolve(filename));
  mkdirSync(parent, { recursive: true });
}

export function createDatabaseClient(options: DatabaseClientOptions = {}): DatabaseClient {
  const configuredUrl = options.filename ?? options.url ?? process.env.DATABASE_URL ?? defaultDatabaseUrl;
  const filename = sqliteFilename(configuredUrl);
  ensureParentDirectory(filename);

  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  if (options.migrate) {
    migrate(db, { migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder });
  }

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}

export function createTestDatabase(migrationsFolder = defaultMigrationsFolder): DatabaseClient {
  return createDatabaseClient({ filename: ":memory:", migrate: true, migrationsFolder });
}

export function migrateDatabase(
  client: DatabaseClient,
  migrationsFolder = defaultMigrationsFolder,
): void {
  migrate(client.db, { migrationsFolder });
}
