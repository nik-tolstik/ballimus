import { randomUUID } from "node:crypto";

import { and, eq, lte } from "drizzle-orm";

import type { AppDatabase } from "./client.js";
import { jobClaims, type JobClaim } from "./schema.js";
import {
  effectiveNow,
  nonEmpty,
  type DatabaseExecutor,
} from "./repositories/common.js";
import {
  NotFoundRepositoryError,
  RepositoryConflictError,
  ValidationRepositoryError,
} from "./repositories/errors.js";

export interface JobClaimOptions {
  readonly leaseDurationMs?: number;
  readonly now?: Date;
  readonly claimToken?: string;
}

export type JobClaimResult =
  | { readonly status: "claimed"; readonly claim: JobClaim }
  | { readonly status: "busy"; readonly claim: JobClaim };

export interface JobRunResult<T> {
  readonly status: "completed" | "busy";
  readonly value?: T;
  readonly claim?: JobClaim;
}

function jobName(value: string): string {
  return nonEmpty(value, "jobName", 255);
}

function leaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000) {
    throw new ValidationRepositoryError("leaseDurationMs must be between 1ms and 24h");
  }
}

/** Database-backed short-run job lease. It prevents overlapping cron executions across processes. */
export class JobClaimsRepository {
  public constructor(protected readonly db: DatabaseExecutor) {}

  public async find(job: string): Promise<JobClaim | undefined> {
    const rows = await this.db.select().from(jobClaims).where(eq(jobClaims.jobName, jobName(job))).limit(1);
    return rows[0];
  }

  public async tryClaim(job: string, options: JobClaimOptions = {}): Promise<JobClaimResult> {
    return this.db.transaction(async (tx) => new JobClaimsRepository(tx).tryClaimInTransaction(job, options));
  }

  public async tryClaimInTransaction(job: string, options: JobClaimOptions = {}): Promise<JobClaimResult> {
    const normalizedJob = jobName(job);
    const duration = options.leaseDurationMs ?? 60_000;
    leaseDuration(duration);
    const now = effectiveNow(options.now);
    const expiresAt = new Date(now.getTime() + duration);
    const token = nonEmpty(options.claimToken ?? randomUUID(), "claimToken", 255);
    const currentRows = await this.db
      .select()
      .from(jobClaims)
      .where(eq(jobClaims.jobName, normalizedJob))
      .limit(1)
      .for("update");
    const current = currentRows[0];
    if (current === undefined) {
      const rows = await this.db
        .insert(jobClaims)
        .values({
          jobName: normalizedJob,
          claimToken: token,
          claimedAt: now,
          leaseExpiresAt: expiresAt,
          lastCompletedAt: null,
          lastError: null,
          updatedAt: now,
        })
        .returning();
      const claim = rows[0];
      if (claim === undefined) throw new RepositoryConflictError(`Job ${normalizedJob} could not be claimed`);
      return { status: "claimed", claim };
    }
    if (current.leaseExpiresAt > now) return { status: "busy", claim: current };
    const rows = await this.db
      .update(jobClaims)
      .set({ claimToken: token, claimedAt: now, leaseExpiresAt: expiresAt, lastError: null, updatedAt: now })
      .where(and(eq(jobClaims.jobName, normalizedJob), lte(jobClaims.leaseExpiresAt, now)))
      .returning();
    const claim = rows[0];
    if (claim === undefined) throw new RepositoryConflictError(`Job ${normalizedJob} was claimed concurrently`);
    return { status: "claimed", claim };
  }

  public async complete(
    job: string,
    claimToken: string,
    completedAt?: Date,
  ): Promise<JobClaim> {
    const normalizedJob = jobName(job);
    const token = nonEmpty(claimToken, "claimToken", 255);
    const now = effectiveNow(completedAt);
    const claimStartedAt = new Date(now.getTime() - 1);
    const rows = await this.db
      .update(jobClaims)
      .set({
        claimToken: token,
        claimedAt: claimStartedAt,
        leaseExpiresAt: now,
        lastCompletedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(jobClaims.jobName, normalizedJob), eq(jobClaims.claimToken, token)))
      .returning();
    const claim = rows[0];
    if (claim === undefined) throw new RepositoryConflictError(`Job ${normalizedJob} is no longer owned by this claim`);
    return claim;
  }

  public async release(job: string, claimToken: string, releasedAt?: Date): Promise<JobClaim> {
    return this.complete(job, claimToken, releasedAt);
  }

  public async fail(
    job: string,
    claimToken: string,
    error: string,
    failedAt?: Date,
  ): Promise<JobClaim> {
    const normalizedJob = jobName(job);
    const token = nonEmpty(claimToken, "claimToken", 255);
    const lastError = nonEmpty(error, "lastError", 2_000);
    const now = effectiveNow(failedAt);
    const rows = await this.db
      .update(jobClaims)
      .set({
        claimToken: token,
        claimedAt: new Date(now.getTime() - 1),
        leaseExpiresAt: now,
        lastError,
        updatedAt: now,
      })
      .where(and(eq(jobClaims.jobName, normalizedJob), eq(jobClaims.claimToken, token)))
      .returning();
    const claim = rows[0];
    if (claim === undefined) throw new RepositoryConflictError(`Job ${normalizedJob} is no longer owned by this claim`);
    return claim;
  }

  /** Acquires a lease, runs one short job, and records completion/failure without holding a DB transaction open. */
  public async run<T>(
    job: string,
    work: (claim: JobClaim) => Promise<T>,
    options: JobClaimOptions = {},
  ): Promise<JobRunResult<T>> {
    const result = await this.tryClaim(job, options);
    if (result.status === "busy") return { status: "busy", claim: result.claim };
    try {
      const value = await work(result.claim);
      const completed = await this.complete(job, result.claim.claimToken);
      return { status: "completed", value, claim: completed };
    } catch (error) {
      await this.fail(job, result.claim.claimToken, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  public async require(job: string): Promise<JobClaim> {
    const claim = await this.find(job);
    if (claim === undefined) throw new NotFoundRepositoryError(`Job ${jobName(job)} has no claim record`);
    return claim;
  }
}

export function createJobClaimsRepository(db: AppDatabase): JobClaimsRepository {
  return new JobClaimsRepository(db);
}
