import type { DatabaseClient } from "@football/db";

/** Shared Nest injection token for the single PostgreSQL application database. */
export const APP_DATABASE = Symbol("APP_DATABASE");

/** Internal token for the client that owns the PostgreSQL pool lifecycle. */
export const APP_DATABASE_CLIENT = Symbol("APP_DATABASE_CLIENT");

export type AppDatabaseClient = DatabaseClient;
