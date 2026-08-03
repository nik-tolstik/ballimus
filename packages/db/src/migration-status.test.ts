import { describe, expect, it } from "vitest";

import { createMigrationStatusReport } from "./migration-status.js";

describe("migration status report", () => {
  it("summarizes the required venue schema without exposing database configuration", () => {
    expect(createMigrationStatusReport({
      migrationLedgerPresent: true,
      appliedMigrationCount: 9,
      venuesTablePresent: true,
      matchesVenueLinkPresent: true,
    })).toEqual({
      migrationLedgerPresent: true,
      appliedMigrationCount: 9,
      venuesTablePresent: true,
      matchesVenueLinkPresent: true,
      schemaPresent: true,
    });
  });

  it("reports an incomplete schema and rejects invalid migration counts", () => {
    expect(createMigrationStatusReport({
      migrationLedgerPresent: true,
      appliedMigrationCount: 8,
      venuesTablePresent: true,
      matchesVenueLinkPresent: false,
    }).schemaPresent).toBe(false);

    expect(() => createMigrationStatusReport({
      migrationLedgerPresent: true,
      appliedMigrationCount: -1,
      venuesTablePresent: true,
      matchesVenueLinkPresent: true,
    })).toThrow("appliedMigrationCount");
  });
});
