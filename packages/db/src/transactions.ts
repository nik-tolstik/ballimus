import type { AppDatabase } from "./client.js";
import {
  OutboxRepository,
  type InsertOutboxEventInput,
} from "./outbox.js";
import { JobClaimsRepository } from "./locks.js";
import {
  ExternalParticipantsRepository,
  type AddExternalParticipantInput,
  type ChangeExternalParticipantQuantityInput,
  type ExternalParticipantMutationResult,
  type RemoveExternalParticipantInput,
  type UpdateExternalParticipantInput,
} from "./repositories/external-participants.js";
import { HttpIdempotencyRepository } from "./repositories/idempotency.js";
import { MatchMessagesRepository } from "./repositories/match-messages.js";
import {
  MatchesRepository,
  type TransitionMatchInput,
} from "./repositories/matches.js";
import { NotificationsRepository } from "./repositories/notifications.js";
import {
  PlayerUsernamesRepository,
  PlayersRepository,
  type CreateAliasInput,
  type TelegramIdentityInput,
} from "./repositories/players.js";
import { TelegramUpdatesRepository } from "./repositories/telegram-updates.js";
import {
  VotesRepository,
  type OwnerVoteInput,
  type RemoveOwnerVoteInput,
  type TelegramVoteInput,
  type TelegramVoteResult,
  type VoteMutationResult,
} from "./repositories/votes.js";
import type { DatabaseTransaction } from "./repositories/common.js";
import type { BindTelegramUserResult } from "./repositories/players.js";
import type { Match } from "./schema.js";

export interface TransactionRepositories {
  readonly matches: MatchesRepository;
  readonly matchMessages: MatchMessagesRepository;
  readonly players: PlayersRepository;
  readonly playerUsernames: PlayerUsernamesRepository;
  readonly votes: VotesRepository;
  readonly externalParticipants: ExternalParticipantsRepository;
  readonly telegramUpdates: TelegramUpdatesRepository;
  readonly idempotency: HttpIdempotencyRepository;
  readonly notifications: NotificationsRepository;
  readonly outbox: OutboxRepository;
  readonly jobClaims: JobClaimsRepository;
  readonly enqueueOutbox: (input: InsertOutboxEventInput) => Promise<OutboxRepositoryResult>;
}

export type OutboxRepositoryResult = Awaited<ReturnType<OutboxRepository["insertInTransaction"]>>;
export type TransactionCallback<T> = (repositories: TransactionRepositories) => Promise<T>;
export type EventFactory<T> =
  | readonly InsertOutboxEventInput[]
  | ((result: T, repositories: TransactionRepositories) => readonly InsertOutboxEventInput[] | Promise<readonly InsertOutboxEventInput[]>);

export function createTransactionRepositories(tx: DatabaseTransaction): TransactionRepositories {
  const outbox = new OutboxRepository(tx);
  return {
    matches: new MatchesRepository(tx),
    matchMessages: new MatchMessagesRepository(tx),
    players: new PlayersRepository(tx),
    playerUsernames: new PlayerUsernamesRepository(tx),
    votes: new VotesRepository(tx),
    externalParticipants: new ExternalParticipantsRepository(tx),
    telegramUpdates: new TelegramUpdatesRepository(tx),
    idempotency: new HttpIdempotencyRepository(tx),
    notifications: new NotificationsRepository(tx),
    outbox,
    jobClaims: new JobClaimsRepository(tx),
    enqueueOutbox: (input) => outbox.insertInTransaction(input),
  };
}

/** Runs business changes and any outbox rows in one PostgreSQL transaction. */
export function withTransaction<T>(db: AppDatabase, callback: TransactionCallback<T>): Promise<T> {
  return db.transaction(async (tx) => callback(createTransactionRepositories(tx)));
}

export const withMatchActionTransaction = withTransaction;
export const withVoteTransaction = withTransaction;
export const withAliasBindingTransaction = withTransaction;
export const withExternalParticipantTransaction = withTransaction;
export const withLifecycleTransaction = withTransaction;

async function appendEvents<T>(
  result: T,
  repositories: TransactionRepositories,
  events: EventFactory<T> | undefined,
): Promise<void> {
  if (events === undefined) return;
  const values = typeof events === "function" ? await events(result, repositories) : events;
  for (const event of values) await repositories.outbox.insertInTransaction(event);
}

export interface AtomicVoteChangeOptions {
  readonly outbox?: EventFactory<TelegramVoteResult>;
}

export async function runVoteChangeTransaction(
  db: AppDatabase,
  input: TelegramVoteInput,
  options: AtomicVoteChangeOptions = {},
): Promise<TelegramVoteResult> {
  return withTransaction(db, async (repositories) => {
    const result = await repositories.votes.applyTelegramVoteInTransaction(input);
    await appendEvents(result, repositories, options.outbox);
    return result;
  });
}

export interface AtomicAliasBindingOptions {
  readonly outbox?: EventFactory<BindTelegramUserResult>;
}

export async function runAliasBindingTransaction(
  db: AppDatabase,
  input: TelegramIdentityInput,
  options: AtomicAliasBindingOptions = {},
): Promise<BindTelegramUserResult> {
  return withTransaction(db, async (repositories) => {
    const result = await repositories.players.bindTelegramUserInTransaction(input);
    await appendEvents(result, repositories, options.outbox);
    return result;
  });
}

export async function runCreateAliasTransaction(
  db: AppDatabase,
  input: CreateAliasInput,
  options: { readonly outbox?: EventFactory<Awaited<ReturnType<PlayersRepository["createAliasInTransaction"]>>> } = {},
): Promise<Awaited<ReturnType<PlayersRepository["createAliasInTransaction"]>>> {
  return withTransaction(db, async (repositories) => {
    const result = await repositories.players.createAliasInTransaction(input);
    await appendEvents(result, repositories, options.outbox);
    return result;
  });
}

export type ExternalParticipantOperation =
  | { readonly kind: "add"; readonly input: AddExternalParticipantInput }
  | { readonly kind: "change"; readonly input: ChangeExternalParticipantQuantityInput }
  | { readonly kind: "update"; readonly input: UpdateExternalParticipantInput }
  | { readonly kind: "remove"; readonly input: RemoveExternalParticipantInput };

export interface AtomicExternalParticipantOptions {
  readonly outbox?: EventFactory<ExternalParticipantMutationResult>;
}

export async function runExternalParticipantTransaction(
  db: AppDatabase,
  operation: ExternalParticipantOperation,
  options: AtomicExternalParticipantOptions = {},
): Promise<ExternalParticipantMutationResult> {
  return withTransaction(db, async (repositories) => {
    const result = operation.kind === "add"
      ? await repositories.externalParticipants.addQuantityInTransaction(operation.input)
      : operation.kind === "change"
        ? await repositories.externalParticipants.changeQuantityInTransaction(operation.input)
        : operation.kind === "update"
          ? await repositories.externalParticipants.updateInTransaction(operation.input)
          : await repositories.externalParticipants.removeInTransaction(operation.input);
    await appendEvents(result, repositories, options.outbox);
    return result;
  });
}

export interface AtomicLifecycleOptions {
  readonly outbox?: EventFactory<Match>;
}

export async function runLifecycleTransaction(
  db: AppDatabase,
  matchId: string | number | bigint,
  input: TransitionMatchInput,
  options: AtomicLifecycleOptions = {},
): Promise<Match> {
  return withTransaction(db, async (repositories) => {
    const result = await repositories.matches.transitionStatus(matchId, input);
    await appendEvents(result, repositories, options.outbox);
    return result;
  });
}

export interface AtomicOwnerVoteOptions {
  readonly outbox?: EventFactory<VoteMutationResult>;
}

export async function runOwnerVoteCorrectionTransaction(
  db: AppDatabase,
  input: OwnerVoteInput,
  options: AtomicOwnerVoteOptions = {},
): Promise<VoteMutationResult> {
  return withTransaction(db, async (repositories) => {
    const result = await repositories.votes.correctByOwnerInTransaction(input);
    await appendEvents(result, repositories, options.outbox);
    return result;
  });
}

export async function runOwnerVoteRemovalTransaction(
  db: AppDatabase,
  input: RemoveOwnerVoteInput,
  options: AtomicOwnerVoteOptions = {},
): Promise<VoteMutationResult> {
  return withTransaction(db, async (repositories) => {
    const result = await repositories.votes.removeByOwnerInTransaction(input);
    await appendEvents(result, repositories, options.outbox);
    return result;
  });
}
