import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppDatabase, ClaimOutboxOptions, JobClaim, JobClaimOptions, JobRunResult, OutboxEvent } from "@football/db";
import { JobClaimsRepository, OutboxRepository } from "@football/db";

import { APP_DATABASE } from "../database/database.constants.js";
import { OutboxDispatcher, type OutboxDispatchResult } from "./outbox.dispatcher.js";

export const JOBS_RUN_JOB_NAME = "jobs:run" as const;
export const DEFAULT_OUTBOX_BATCH_SIZE = 20;
export const DEFAULT_JOB_LEASE_DURATION_MS = 60_000;

export interface JobClaimsPort {
  run<T>(job: string, work: (claim: JobClaim) => Promise<T>, options?: JobClaimOptions): Promise<JobRunResult<T>>;
}

export interface OutboxClaimPort {
  claim(options?: ClaimOutboxOptions): Promise<OutboxEvent[]>;
}

export interface JobsRunSummary {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly uncertain: number;
  readonly events: readonly OutboxDispatchResult[];
}

export type JobsRunOnceResult =
  | { readonly status: "busy"; readonly jobName: typeof JOBS_RUN_JOB_NAME; readonly claim: JobClaim }
  | { readonly status: "completed"; readonly jobName: typeof JOBS_RUN_JOB_NAME; readonly claim?: JobClaim; readonly summary: JobsRunSummary };

function count(events: readonly OutboxDispatchResult[], status: OutboxDispatchResult["status"]): number {
  return events.filter((event) => event.status === status).length;
}

/** Runs one bounded durable-outbox drain. */
@Injectable()
export class JobsRunner {
  private readonly jobClaims: JobClaimsPort;
  private readonly outbox: OutboxClaimPort;

  public constructor(
    @Inject(APP_DATABASE) db: AppDatabase,
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @Optional() jobClaims?: JobClaimsPort,
    @Optional() outbox?: OutboxClaimPort,
  ) {
    this.jobClaims = jobClaims ?? new JobClaimsRepository(db);
    this.outbox = outbox ?? new OutboxRepository(db);
  }

  public async runOnce(options: { readonly now?: Date; readonly leaseDurationMs?: number; readonly outboxBatchSize?: number } = {}): Promise<JobsRunOnceResult> {
    const now = options.now ?? new Date();
    const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_JOB_LEASE_DURATION_MS;
    const outboxBatchSize = options.outboxBatchSize ?? DEFAULT_OUTBOX_BATCH_SIZE;
    const result = await this.jobClaims.run(JOBS_RUN_JOB_NAME, async (): Promise<JobsRunSummary> => {
      const events = await this.outbox.claim({ limit: outboxBatchSize, leaseDurationMs, now });
      const outcomes: OutboxDispatchResult[] = [];
      for (const event of events) outcomes.push(await this.dispatcher.dispatch(event, { now }));
      return {
        claimed: events.length,
        delivered: count(outcomes, "delivered"),
        failed: count(outcomes, "failed"),
        uncertain: count(outcomes, "uncertain"),
        events: outcomes,
      };
    }, { leaseDurationMs, now });
    if (result.status === "busy") {
      if (result.claim === undefined) throw new Error("Busy jobs run did not return a claim");
      return { status: "busy", jobName: JOBS_RUN_JOB_NAME, claim: result.claim };
    }
    if (result.value === undefined) throw new Error("Completed jobs run did not return a summary");
    return { status: "completed", jobName: JOBS_RUN_JOB_NAME, ...(result.claim === undefined ? {} : { claim: result.claim }), summary: result.value };
  }
}
