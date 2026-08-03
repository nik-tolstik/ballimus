import postgres from "postgres";

import { assertPostgresDatabaseUrl } from "./client.js";

export interface MigrationStatusSnapshot {
  readonly migrationLedgerPresent: boolean;
  readonly appliedMigrationCount: number;
  readonly venuesTablePresent: boolean;
  readonly matchesVenueLinkPresent: boolean;
}

export interface MigrationStatusReport extends MigrationStatusSnapshot {
  readonly schemaPresent: boolean;
}

interface MigrationStatusSchemaRow {
  readonly migration_ledger_present: boolean;
  readonly venues_table_present: boolean;
  readonly matches_venue_link_present: boolean;
}

interface MigrationCountRow {
  readonly applied_migration_count: number;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

export function createMigrationStatusReport(snapshot: MigrationStatusSnapshot): MigrationStatusReport {
  return {
    ...snapshot,
    appliedMigrationCount: nonNegativeInteger(snapshot.appliedMigrationCount, "appliedMigrationCount"),
    schemaPresent: snapshot.venuesTablePresent && snapshot.matchesVenueLinkPresent,
  };
}

export async function readMigrationStatus(databaseUrl = process.env["DATABASE_URL"]): Promise<MigrationStatusReport> {
  const sql = postgres(assertPostgresDatabaseUrl(databaseUrl), { max: 1 });

  try {
    const schemaRows = await sql<MigrationStatusSchemaRow[]>`
      select
        to_regclass('drizzle.__drizzle_migrations') is not null as migration_ledger_present,
        to_regclass('public.venues') is not null as venues_table_present,
        exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'matches'
            and column_name = 'venue_id'
        ) as matches_venue_link_present
    `;
    const schema = schemaRows[0];
    if (schema === undefined) throw new Error("Migration status query returned no row");

    const countRows = schema.migration_ledger_present
      ? await sql<MigrationCountRow[]>`
          select count(*)::int as applied_migration_count
          from drizzle.__drizzle_migrations
        `
      : [];
    const count = countRows[0]?.applied_migration_count ?? 0;

    return createMigrationStatusReport({
      migrationLedgerPresent: schema.migration_ledger_present,
      appliedMigrationCount: count,
      venuesTablePresent: schema.venues_table_present,
      matchesVenueLinkPresent: schema.matches_venue_link_present,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
