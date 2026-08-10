import type { AppDatabase } from "./client.js";
import { JobClaimsRepository } from "./locks.js";
import { OutboxRepository, type InsertOutboxEventInput } from "./outbox.js";
import { HttpIdempotencyRepository } from "./repositories/idempotency.js";
import { MatchMessagesRepository } from "./repositories/match-messages.js";
import { MatchesRepository } from "./repositories/matches.js";
import { VenuesRepository } from "./repositories/venues.js";
import type { DatabaseTransaction } from "./repositories/common.js";

export interface TransactionRepositories {
  readonly matches: MatchesRepository;
  readonly matchMessages: MatchMessagesRepository;
  readonly venues: VenuesRepository;
  readonly idempotency: HttpIdempotencyRepository;
  readonly outbox: OutboxRepository;
  readonly jobClaims: JobClaimsRepository;
  readonly enqueueOutbox: (input: InsertOutboxEventInput) => Promise<OutboxRepositoryResult>;
}

export type OutboxRepositoryResult = Awaited<ReturnType<OutboxRepository["insertInTransaction"]>>;
export type TransactionCallback<T> = (repositories: TransactionRepositories) => Promise<T>;

export function createTransactionRepositories(tx: DatabaseTransaction): TransactionRepositories {
  const outbox = new OutboxRepository(tx);
  return {
    matches: new MatchesRepository(tx),
    matchMessages: new MatchMessagesRepository(tx),
    venues: new VenuesRepository(tx),
    idempotency: new HttpIdempotencyRepository(tx),
    outbox,
    jobClaims: new JobClaimsRepository(tx),
    enqueueOutbox: (input) => outbox.insertInTransaction(input),
  };
}

/** Runs a business mutation and its durable outgoing effects in one transaction. */
export function withTransaction<T>(db: AppDatabase, callback: TransactionCallback<T>): Promise<T> {
  return db.transaction(async (tx) => callback(createTransactionRepositories(tx)));
}
