import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const venueTypes = ["outdoor", "indoor"] as const;
export type VenueType = (typeof venueTypes)[number];

export interface BookingContact {
  readonly name?: string;
  readonly phone: string;
}

export const publicationStates = ["pending", "published", "uncertain", "failed", "deleted"] as const;
export type PublicationState = (typeof publicationStates)[number];

export const pollPublicationStates = ["pending", "published", "uncertain", "failed", "cancelled"] as const;
export type PollPublicationState = (typeof pollPublicationStates)[number];

export const telegramPollVoterKinds = ["user", "chat"] as const;
export type TelegramPollVoterKind = (typeof telegramPollVoterKinds)[number];

export const httpIdempotencyStatuses = ["processing", "succeeded", "failed"] as const;
export type HttpIdempotencyStatus = (typeof httpIdempotencyStatuses)[number];

export const outboxEventTypes = [
  "publish_public_card",
  "refresh_public_card",
  "delete_public_card",
] as const;
export type OutboxEventType = (typeof outboxEventTypes)[number];

export const outboxDeliveryStates = ["pending", "processing", "delivered", "failed", "uncertain"] as const;
export type OutboxDeliveryState = (typeof outboxDeliveryStates)[number];

export interface TelegramPollOptionState {
  readonly text: string;
  readonly notificationEnabled: boolean;
  readonly voterCount: number;
  readonly notificationQueuedAt: string | null;
}

const sqlStringList = (values: readonly string[]) => sql.join(values.map((value) => sql.raw(`'${value}'`)), sql`, `);
const venueTypeSql = sqlStringList(venueTypes);
const publicationStateSql = sqlStringList(publicationStates);
const pollPublicationStateSql = sqlStringList(pollPublicationStates);
const telegramPollVoterKindSql = sqlStringList(telegramPollVoterKinds);
const idempotencyStateSql = sqlStringList(httpIdempotencyStatuses);
const outboxEventSql = sqlStringList(outboxEventTypes);
const outboxDeliverySql = sqlStringList(outboxDeliveryStates);

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const venues = pgTable(
  "venues",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    name: text("name").notNull(),
    mapUrl: text("map_url").notNull(),
    venueType: text("venue_type", { enum: venueTypes }).notNull(),
    bookingContacts: jsonb("booking_contacts").$type<BookingContact[]>().notNull().default(sql`'[]'::jsonb`),
    websiteUrl: text("website_url"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("venues_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("venues_map_url_not_empty", sql`length(trim(${table.mapUrl})) > 0`),
    check("venues_type_valid", sql`${table.venueType} in (${venueTypeSql})`),
    check("venues_booking_contacts_valid", sql`case when jsonb_typeof(${table.bookingContacts}) = 'array' then jsonb_array_length(${table.bookingContacts}) between 0 and 5 else false end`),
    check("venues_version_positive", sql`${table.version} >= 1`),
    uniqueIndex("venues_name_ci_unique").on(sql`lower(${table.name})`),
    index("venues_archived_at_idx").on(table.archivedAt),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(90),
    venueId: bigint("venue_id", { mode: "bigint" }).notNull().references(() => venues.id, { onDelete: "restrict", onUpdate: "cascade" }),
    fieldPriceRubles: integer("field_price_rubles"),
    creatorTelegramUserId: bigint("creator_telegram_user_id", { mode: "bigint" }).notNull(),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true, mode: "date" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("matches_telegram_chat_id_non_zero", sql`${table.telegramChatId} <> 0`),
    check("matches_creator_telegram_user_id_positive", sql`${table.creatorTelegramUserId} > 0`),
    check("matches_duration_minutes_valid", sql`${table.durationMinutes} between 15 and 480`),
    check("matches_field_price_non_negative", sql`${table.fieldPriceRubles} is null or ${table.fieldPriceRubles} >= 0`),
    check("matches_version_positive", sql`${table.version} >= 1`),
    unique("matches_id_chat_unique").on(table.id, table.telegramChatId),
    index("matches_venue_id_idx").on(table.venueId),
    index("matches_active_idx").on(table.telegramChatId, table.deletionRequestedAt, table.scheduledAt),
  ],
);

export const matchMessages = pgTable(
  "match_messages",
  {
    matchId: bigint("match_id", { mode: "bigint" }).primaryKey(),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramTopicId: bigint("telegram_topic_id", { mode: "bigint" }),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }),
    publicationState: text("publication_state", { enum: publicationStates }).notNull().default("pending"),
    publicationAttemptedAt: timestamp("publication_attempted_at", { withTimezone: true, mode: "date" }),
    publicationUncertainAt: timestamp("publication_uncertain_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "match_messages_match_chat_fk",
      columns: [table.matchId, table.telegramChatId],
      foreignColumns: [matches.id, matches.telegramChatId],
    }).onDelete("cascade").onUpdate("cascade"),
    check("match_messages_telegram_chat_id_non_zero", sql`${table.telegramChatId} <> 0`),
    check("match_messages_telegram_topic_id_positive", sql`${table.telegramTopicId} is null or ${table.telegramTopicId} > 0`),
    check("match_messages_telegram_message_id_positive", sql`${table.telegramMessageId} is null or ${table.telegramMessageId} > 0`),
    check("match_messages_publication_state_valid", sql`${table.publicationState} in (${publicationStateSql})`),
    check("match_messages_publication_reference_consistent", sql`(
      (${table.publicationState} in ('published', 'deleted') and ${table.telegramMessageId} is not null)
      or (${table.publicationState} in ('pending', 'uncertain', 'failed') and ${table.telegramMessageId} is null)
    )`),
    check("match_messages_uncertain_state_explicit", sql`(
      (${table.publicationState} = 'uncertain' and ${table.publicationUncertainAt} is not null)
      or (${table.publicationState} <> 'uncertain' and ${table.publicationUncertainAt} is null)
    )`),
    check("match_messages_attempt_state_consistent", sql`(
      (${table.publicationState} = 'pending' and ${table.publicationAttemptedAt} is null)
      or (${table.publicationState} <> 'pending' and ${table.publicationAttemptedAt} is not null)
    )`),
    check("match_messages_error_state_consistent", sql`(
      (${table.publicationState} in ('failed', 'uncertain') and ${table.lastError} is not null and length(trim(${table.lastError})) > 0)
      or (${table.publicationState} in ('pending', 'published', 'deleted') and ${table.lastError} is null)
    )`),
    uniqueIndex("match_messages_telegram_reference_unique").on(table.telegramChatId, sql`coalesce(${table.telegramTopicId}, 0)`, table.telegramMessageId).where(sql`${table.telegramMessageId} is not null`),
    index("match_messages_publication_state_idx").on(table.publicationState, table.updatedAt),
  ],
);

export const httpIdempotencyKeys = pgTable(
  "http_idempotency_keys",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    ownerTelegramUserId: bigint("owner_telegram_user_id", { mode: "bigint" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: httpIdempotencyStatuses }).notNull().default("processing"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown> | null>(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("http_idempotency_owner_positive", sql`${table.ownerTelegramUserId} > 0`),
    check("http_idempotency_key_not_empty", sql`length(trim(${table.idempotencyKey})) between 1 and 255`),
    check("http_idempotency_request_hash_not_empty", sql`length(trim(${table.requestHash})) > 0`),
    check("http_idempotency_status_valid", sql`${table.status} in (${idempotencyStateSql})`),
    check("http_idempotency_response_status_valid", sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`),
    check("http_idempotency_completion_consistent", sql`(
      (${table.status} = 'processing' and ${table.completedAt} is null)
      or (${table.status} in ('succeeded', 'failed') and ${table.completedAt} is not null and ${table.responseStatus} is not null)
    )`),
    unique("http_idempotency_owner_key_unique").on(table.ownerTelegramUserId, table.idempotencyKey),
    index("http_idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const telegramPolls = pgTable(
  "telegram_polls",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    telegramPollId: text("telegram_poll_id"),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramTopicId: bigint("telegram_topic_id", { mode: "bigint" }),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }),
    question: text("question").notNull(),
    options: jsonb("options").$type<TelegramPollOptionState[]>().notNull(),
    notificationThreshold: integer("notification_threshold"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    allowsMultipleAnswers: boolean("allows_multiple_answers").notNull().default(false),
    allowsRevoting: boolean("allows_revoting").notNull().default(true),
    publicationState: text("publication_state", { enum: pollPublicationStates }).notNull().default("pending"),
    publicationAttemptedAt: timestamp("publication_attempted_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    creatorTelegramUserId: bigint("creator_telegram_user_id", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("telegram_polls_chat_id_non_zero", sql`${table.telegramChatId} <> 0`),
    check("telegram_polls_topic_id_positive", sql`${table.telegramTopicId} is null or ${table.telegramTopicId} > 0`),
    check("telegram_polls_message_id_positive", sql`${table.telegramMessageId} is null or ${table.telegramMessageId} > 0`),
    check("telegram_polls_question_valid", sql`length(${table.question}) between 1 and 300`),
    check("telegram_polls_options_valid", sql`jsonb_typeof(${table.options}) = 'array' and jsonb_array_length(${table.options}) between 2 and 12`),
    check("telegram_polls_notification_threshold_valid", sql`${table.notificationThreshold} is null or ${table.notificationThreshold} between 1 and 1000000`),
    check("telegram_polls_publication_state_valid", sql`${table.publicationState} in (${pollPublicationStateSql})`),
    check("telegram_polls_creator_positive", sql`${table.creatorTelegramUserId} > 0`),
    check("telegram_polls_publication_reference_consistent", sql`(
      (${table.publicationState} = 'published' and ${table.telegramPollId} is not null and ${table.telegramMessageId} is not null)
      or (${table.publicationState} in ('pending', 'uncertain', 'failed', 'cancelled') and ${table.telegramPollId} is null and ${table.telegramMessageId} is null)
    )`),
    check("telegram_polls_attempt_state_consistent", sql`(
      (${table.publicationState} = 'pending' and ${table.publicationAttemptedAt} is null)
      or (${table.publicationState} <> 'pending' and ${table.publicationAttemptedAt} is not null)
    )`),
    check("telegram_polls_error_state_consistent", sql`(
      (${table.publicationState} in ('failed', 'uncertain') and ${table.lastError} is not null and length(trim(${table.lastError})) > 0)
      or (${table.publicationState} in ('pending', 'published', 'cancelled') and ${table.lastError} is null)
    )`),
    uniqueIndex("telegram_polls_telegram_poll_id_unique").on(table.telegramPollId).where(sql`${table.telegramPollId} is not null`),
    index("telegram_polls_chat_created_idx").on(table.telegramChatId, table.createdAt),
  ],
);

export const telegramPollVoterAnswers = pgTable(
  "telegram_poll_voter_answers",
  {
    pollId: bigint("poll_id", { mode: "bigint" }).notNull().references(() => telegramPolls.id, { onDelete: "cascade", onUpdate: "cascade" }),
    voterKind: text("voter_kind", { enum: telegramPollVoterKinds }).notNull(),
    telegramVoterId: bigint("telegram_voter_id", { mode: "bigint" }).notNull(),
    username: text("username"),
    displayName: text("display_name").notNull(),
    selectedOptionIndexes: jsonb("selected_option_indexes").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    lastTelegramUpdateId: bigint("last_telegram_update_id", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: "telegram_poll_voter_answers_pk", columns: [table.pollId, table.voterKind, table.telegramVoterId] }),
    check("telegram_poll_voter_answers_kind_valid", sql`${table.voterKind} in (${telegramPollVoterKindSql})`),
    check("telegram_poll_voter_answers_voter_id_non_zero", sql`${table.telegramVoterId} <> 0`),
    check("telegram_poll_voter_answers_username_valid", sql`${table.username} is null or length(trim(${table.username})) between 1 and 255`),
    check("telegram_poll_voter_answers_display_name_valid", sql`length(trim(${table.displayName})) between 1 and 255`),
    check("telegram_poll_voter_answers_options_valid", sql`jsonb_typeof(${table.selectedOptionIndexes}) = 'array'`),
    check("telegram_poll_voter_answers_update_id_non_negative", sql`${table.lastTelegramUpdateId} >= 0`),
    index("telegram_poll_voter_answers_poll_idx").on(table.pollId),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    eventType: text("event_type", { enum: outboxEventTypes }).notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    matchId: bigint("match_id", { mode: "bigint" }).references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramTopicId: bigint("telegram_topic_id", { mode: "bigint" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    deliveryState: text("delivery_state", { enum: outboxDeliveryStates }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    uncertainAt: timestamp("uncertain_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("outbox_event_type_valid", sql`${table.eventType} in (${outboxEventSql})`),
    check("outbox_deduplication_key_not_empty", sql`length(trim(${table.deduplicationKey})) > 0`),
    check("outbox_telegram_chat_id_non_zero", sql`${table.telegramChatId} <> 0`),
    check("outbox_telegram_topic_id_positive", sql`${table.telegramTopicId} is null or ${table.telegramTopicId} > 0`),
    check("outbox_attempt_count_non_negative", sql`${table.attemptCount} >= 0`),
    check("outbox_event_scope_consistent", sql`${table.eventType} = 'delete_public_card' or ${table.matchId} is not null`),
    check("outbox_delivery_state_valid", sql`${table.deliveryState} in (${outboxDeliverySql})`),
    check("outbox_delivery_timestamps_consistent", sql`(
      (${table.deliveryState} = 'delivered' and ${table.deliveredAt} is not null and ${table.uncertainAt} is null)
      or (${table.deliveryState} = 'uncertain' and ${table.deliveredAt} is null and ${table.uncertainAt} is not null)
      or (${table.deliveryState} in ('pending', 'processing', 'failed') and ${table.deliveredAt} is null and ${table.uncertainAt} is null)
    )`),
    check("outbox_error_consistent", sql`(
      (${table.deliveryState} in ('failed', 'uncertain') and ${table.lastError} is not null and length(trim(${table.lastError})) > 0)
      or (${table.deliveryState} in ('pending', 'processing', 'delivered') and ${table.lastError} is null)
    )`),
    unique("outbox_deduplication_key_unique").on(table.deduplicationKey),
    index("outbox_delivery_queue_idx").on(table.deliveryState, table.availableAt),
    index("outbox_match_idx").on(table.matchId, table.createdAt),
  ],
);

export const jobClaims = pgTable(
  "job_claims",
  {
    jobName: text("job_name").primaryKey(),
    claimToken: text("claim_token").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("job_claims_job_name_not_empty", sql`length(trim(${table.jobName})) > 0`),
    check("job_claims_token_not_empty", sql`length(trim(${table.claimToken})) > 0`),
    check("job_claims_lease_after_claim", sql`${table.leaseExpiresAt} > ${table.claimedAt}`),
    check("job_claims_error_not_empty", sql`${table.lastError} is null or length(trim(${table.lastError})) > 0`),
  ],
);

export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchMessage = typeof matchMessages.$inferSelect;
export type NewMatchMessage = typeof matchMessages.$inferInsert;
export type HttpIdempotencyKey = typeof httpIdempotencyKeys.$inferSelect;
export type NewHttpIdempotencyKey = typeof httpIdempotencyKeys.$inferInsert;
export type OutboxEvent = typeof outbox.$inferSelect;
export type NewOutboxEvent = typeof outbox.$inferInsert;
export type JobClaim = typeof jobClaims.$inferSelect;
export type NewJobClaim = typeof jobClaims.$inferInsert;
export type TelegramPoll = typeof telegramPolls.$inferSelect;
export type NewTelegramPoll = typeof telegramPolls.$inferInsert;
export type TelegramPollVoterAnswer = typeof telegramPollVoterAnswers.$inferSelect;
export type NewTelegramPollVoterAnswer = typeof telegramPollVoterAnswers.$inferInsert;

export const schema = { venues, matches, matchMessages, telegramPolls, telegramPollVoterAnswers, httpIdempotencyKeys, outbox, jobClaims };
export type DatabaseSchema = typeof schema;
