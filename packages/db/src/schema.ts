import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
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

export const matchStatuses = ["draft", "active", "confirmed", "completed", "cancelled"] as const;
export type MatchStatus = (typeof matchStatuses)[number];

export const venueTypes = ["outdoor", "indoor"] as const;
export type VenueType = (typeof venueTypes)[number];

export const matchTimeModes = ["exact", "exact_options", "availability"] as const;
export type MatchTimeMode = (typeof matchTimeModes)[number];

export const voteOptions = ["going", "not_going", "maybe"] as const;
export type VoteOption = (typeof voteOptions)[number];

export const voteSources = ["telegram_callback", "owner_correction"] as const;
export type VoteSource = (typeof voteSources)[number];

export const playerAvatarContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type PlayerAvatarContentType = (typeof playerAvatarContentTypes)[number];

export const publicationStates = [
  "pending",
  "published",
  "uncertain",
  "failed",
  "deleted",
] as const;
export type PublicationState = (typeof publicationStates)[number];

export const telegramUpdateStatuses = ["processing", "processed", "failed"] as const;
export type TelegramUpdateStatus = (typeof telegramUpdateStatuses)[number];

export const httpIdempotencyStatuses = ["processing", "succeeded", "failed"] as const;
export type HttpIdempotencyStatus = (typeof httpIdempotencyStatuses)[number];

export const notificationTypes = [
  "threshold_reached",
  "threshold_lost",
  "match_confirmed",
  "match_cancelled",
  "weather_forecast",
] as const;
export type NotificationType = (typeof notificationTypes)[number];

export const notificationDeliveryStates = ["pending", "sent", "failed", "uncertain"] as const;
export type NotificationDeliveryState = (typeof notificationDeliveryStates)[number];

export const outboxEventTypes = [
  "publish_public_card",
  "refresh_public_card",
  "delete_public_card",
  "send_notification",
  "reconcile_public_card",
] as const;
export type OutboxEventType = (typeof outboxEventTypes)[number];

export const outboxDeliveryStates = [
  "pending",
  "processing",
  "delivered",
  "failed",
  "uncertain",
] as const;
export type OutboxDeliveryState = (typeof outboxDeliveryStates)[number];

const sqlStringList = (values: readonly string[]) =>
  sql.join(values.map((value) => sql.raw(`'${value}'`)), sql`, `);

const matchStatusSql = sqlStringList(matchStatuses);
const venueTypeSql = sqlStringList(venueTypes);
const matchTimeModeSql = sqlStringList(matchTimeModes);
const voteOptionSql = sqlStringList(voteOptions);
const voteSourceSql = sqlStringList(voteSources);
const playerAvatarContentTypeSql = sqlStringList(playerAvatarContentTypes);
const publicationStateSql = sqlStringList(publicationStates);
const telegramUpdateStatusSql = sqlStringList(telegramUpdateStatuses);
const httpIdempotencyStatusSql = sqlStringList(httpIdempotencyStatuses);
const notificationTypeSql = sqlStringList(notificationTypes);
const notificationDeliveryStateSql = sqlStringList(notificationDeliveryStates);
const outboxEventTypeSql = sqlStringList(outboxEventTypes);
const outboxDeliveryStateSql = sqlStringList(outboxDeliveryStates);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const telegramUpdates = pgTable(
  "telegram_updates",
  {
    updateId: bigint("update_id", { mode: "bigint" }).primaryKey(),
    status: text("status", { enum: telegramUpdateStatuses }).notNull().default("processing"),
    attemptCount: integer("attempt_count").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
  },
  (table) => [
    check("telegram_updates_update_id_non_negative", sql`${table.updateId} >= 0`),
    check("telegram_updates_attempt_count_non_negative", sql`${table.attemptCount} >= 0`),
    check(
      "telegram_updates_status_valid",
      sql`${table.status} in (${telegramUpdateStatusSql})`,
    ),
    check(
      "telegram_updates_status_timestamps_consistent",
      sql`(
        (${table.status} = 'processing' and ${table.processedAt} is null and ${table.failedAt} is null)
        or (${table.status} = 'processed' and ${table.processedAt} is not null and ${table.failedAt} is null)
        or (${table.status} = 'failed' and ${table.processedAt} is null and ${table.failedAt} is not null and ${table.lastError} is not null)
      )`,
    ),
    index("telegram_updates_status_idx").on(table.status, table.receivedAt),
  ],
);

export const players = pgTable(
  "players",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }),
    displayName: text("display_name"),
    telegramUsernameSnapshot: text("telegram_username_snapshot"),
    telegramFirstNameSnapshot: text("telegram_first_name_snapshot"),
    telegramLastNameSnapshot: text("telegram_last_name_snapshot"),
    telegramLanguageCode: text("telegram_language_code"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    avatarFileUniqueId: text("avatar_file_unique_id"),
    avatarContentType: text("avatar_content_type", { enum: playerAvatarContentTypes }),
    avatarDataBase64: text("avatar_data_base64"),
    avatarRefreshedAt: timestamp("avatar_refreshed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "players_telegram_user_id_positive",
      sql`${table.telegramUserId} is null or ${table.telegramUserId} > 0`,
    ),
    check(
      "players_display_name_not_empty",
      sql`${table.displayName} is null or length(trim(${table.displayName})) > 0`,
    ),
    check(
      "players_avatar_content_type_valid",
      sql`${table.avatarContentType} is null or ${table.avatarContentType} in (${playerAvatarContentTypeSql})`,
    ),
    check(
      "players_avatar_cache_consistent",
      sql`(
        (${table.avatarFileUniqueId} is null and ${table.avatarContentType} is null and ${table.avatarDataBase64} is null)
        or (
          ${table.avatarFileUniqueId} is not null
          and length(trim(${table.avatarFileUniqueId})) > 0
          and ${table.avatarContentType} is not null
          and ${table.avatarDataBase64} is not null
          and length(${table.avatarDataBase64}) between 1 and 349528
        )
      )`,
    ),
    uniqueIndex("players_telegram_user_id_unique").on(table.telegramUserId),
    index("players_display_name_idx").on(table.displayName),
  ],
);

export const venues = pgTable(
  "venues",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    name: text("name").notNull(),
    mapUrl: text("map_url").notNull(),
    venueType: text("venue_type", { enum: venueTypes }).notNull(),
    bookingPhones: text("booking_phones").array().notNull().default(sql`ARRAY[]::text[]`),
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
    check("venues_booking_phones_limit", sql`cardinality(${table.bookingPhones}) between 0 and 5`),
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
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }),
    scheduleDate: date("schedule_date", { mode: "string" }),
    timeMode: text("time_mode", { enum: matchTimeModes }).notNull().default("exact"),
    timeOptions: jsonb("time_options").$type<string[]>().notNull().default([]),
    selectedTime: text("selected_time"),
    venueId: bigint("venue_id", { mode: "bigint" }).references(() => venues.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    location: text("location"),
    venueType: text("venue_type", { enum: venueTypes }),
    fieldPriceRubles: integer("field_price_rubles"),
    title: text("title"),
    requiredPlayers: integer("required_players").notNull(),
    status: text("status", { enum: matchStatuses }).notNull().default("draft"),
    cancellationReason: text("cancellation_reason"),
    creatorTelegramUserId: bigint("creator_telegram_user_id", { mode: "bigint" }).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("matches_telegram_chat_id_non_zero", sql`${table.telegramChatId} <> 0`),
    check("matches_creator_telegram_user_id_positive", sql`${table.creatorTelegramUserId} > 0`),
    check("matches_required_players_positive", sql`${table.requiredPlayers} >= 1`),
    check(
      "matches_location_not_empty",
      sql`${table.location} is null or length(trim(${table.location})) > 0`,
    ),
    check(
      "matches_title_not_empty",
      sql`${table.title} is null or length(trim(${table.title})) > 0`,
    ),
    check(
      "matches_venue_type_valid",
      sql`${table.venueType} is null or ${table.venueType} in (${venueTypeSql})`,
    ),
    index("matches_venue_id_idx").on(table.venueId),
    check(
      "matches_field_price_non_negative",
      sql`${table.fieldPriceRubles} is null or ${table.fieldPriceRubles} >= 0`,
    ),
    check("matches_status_valid", sql`${table.status} in (${matchStatusSql})`),
    check("matches_time_mode_valid", sql`${table.timeMode} in (${matchTimeModeSql})`),
    check(
      "matches_selected_time_valid",
      sql`${table.selectedTime} is null or ${table.selectedTime} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "matches_time_configuration_consistent",
      sql`(
        (${table.timeMode} = 'exact' and jsonb_array_length(${table.timeOptions}) = 0 and ${table.selectedTime} is null)
        or (
          ${table.timeMode} in ('exact_options', 'availability')
          and ${table.scheduleDate} is not null
          and jsonb_typeof(${table.timeOptions}) = 'array'
          and jsonb_array_length(${table.timeOptions}) between 1 and 6
          and (${table.selectedTime} is null or ${table.timeOptions} ? ${table.selectedTime})
        )
      )`,
    ),
    check("matches_version_positive", sql`${table.version} >= 1`),
    check(
      "matches_cancellation_state_consistent",
      sql`(
        (${table.status} = 'cancelled' and ${table.cancellationReason} is not null and length(trim(${table.cancellationReason})) > 0)
        or (${table.status} <> 'cancelled' and ${table.cancellationReason} is null)
      )`,
    ),
    unique("matches_id_chat_unique").on(table.id, table.telegramChatId),
    index("matches_chat_status_idx").on(table.telegramChatId, table.status),
    index("matches_scheduled_at_idx").on(table.scheduledAt),
  ],
);

export const playerUsernames = pgTable(
  "player_usernames",
  {
    normalizedUsername: text("normalized_username").primaryKey(),
    playerId: bigint("player_id", { mode: "bigint" })
      .notNull()
      .references(() => players.id, { onDelete: "restrict", onUpdate: "cascade" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "player_usernames_normalized_valid",
      sql`
        length(${table.normalizedUsername}) between 1 and 32
        and ${table.normalizedUsername} = lower(${table.normalizedUsername})
        and ${table.normalizedUsername} !~ '@'
      `,
    ),
    index("player_usernames_player_idx").on(table.playerId),
  ],
);

export const matchMessages = pgTable(
  "match_messages",
  {
    matchId: bigint("match_id", { mode: "bigint" }).primaryKey(),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramTopicId: bigint("telegram_topic_id", { mode: "bigint" }),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }),
    publicationState: text("publication_state", { enum: publicationStates })
      .notNull()
      .default("pending"),
    publicationAttemptedAt: timestamp("publication_attempted_at", {
      withTimezone: true,
      mode: "date",
    }),
    publicationUncertainAt: timestamp("publication_uncertain_at", {
      withTimezone: true,
      mode: "date",
    }),
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
    check(
      "match_messages_telegram_topic_id_positive",
      sql`${table.telegramTopicId} is null or ${table.telegramTopicId} > 0`,
    ),
    check(
      "match_messages_telegram_message_id_positive",
      sql`${table.telegramMessageId} is null or ${table.telegramMessageId} > 0`,
    ),
    check(
      "match_messages_publication_state_valid",
      sql`${table.publicationState} in (${publicationStateSql})`,
    ),
    check(
      "match_messages_publication_reference_consistent",
      sql`(
        (${table.publicationState} in ('published', 'deleted') and ${table.telegramMessageId} is not null)
        or (${table.publicationState} in ('pending', 'uncertain', 'failed') and ${table.telegramMessageId} is null)
      )`,
    ),
    check(
      "match_messages_uncertain_state_explicit",
      sql`(
        (${table.publicationState} = 'uncertain' and ${table.publicationUncertainAt} is not null)
        or (${table.publicationState} <> 'uncertain' and ${table.publicationUncertainAt} is null)
      )`,
    ),
    check(
      "match_messages_attempt_state_consistent",
      sql`(
        (${table.publicationState} = 'pending' and ${table.publicationAttemptedAt} is null)
        or (${table.publicationState} <> 'pending' and ${table.publicationAttemptedAt} is not null)
      )`,
    ),
    check(
      "match_messages_error_state_consistent",
      sql`(
        (${table.publicationState} in ('failed', 'uncertain') and ${table.lastError} is not null and length(trim(${table.lastError})) > 0)
        or (${table.publicationState} in ('pending', 'published', 'deleted') and ${table.lastError} is null)
      )`,
    ),
    uniqueIndex("match_messages_telegram_reference_unique")
      .on(
        table.telegramChatId,
        sql`coalesce(${table.telegramTopicId}, 0)`,
        table.telegramMessageId,
      )
      .where(sql`${table.telegramMessageId} is not null`),
    index("match_messages_publication_state_idx").on(table.publicationState, table.updatedAt),
  ],
);

export const votes = pgTable(
  "votes",
  {
    matchId: bigint("match_id", { mode: "bigint" })
      .notNull()
      .references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    playerId: bigint("player_id", { mode: "bigint" })
      .notNull()
      .references(() => players.id, { onDelete: "restrict", onUpdate: "cascade" }),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull(),
    usernameSnapshot: text("username_snapshot"),
    firstNameSnapshot: text("first_name_snapshot"),
    lastNameSnapshot: text("last_name_snapshot"),
    displayNameSnapshot: text("display_name_snapshot").notNull(),
    option: text("option", { enum: voteOptions }).notNull(),
    availableAfter: text("available_after"),
    exactTimes: jsonb("exact_times").$type<string[]>().notNull().default([]),
    source: text("source", { enum: voteSources }).notNull(),
    telegramUpdateId: bigint("telegram_update_id", { mode: "bigint" }).references(
      () => telegramUpdates.updateId,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.playerId] }),
    check("votes_telegram_user_id_positive", sql`${table.telegramUserId} > 0`),
    check("votes_option_valid", sql`${table.option} in (${voteOptionSql})`),
    check(
      "votes_available_after_valid",
      sql`${table.availableAfter} is null or ${table.availableAfter} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "votes_available_after_option_consistent",
      sql`${table.option} = 'going' or (${table.availableAfter} is null and jsonb_array_length(${table.exactTimes}) = 0)`,
    ),
    check("votes_exact_times_array", sql`jsonb_typeof(${table.exactTimes}) = 'array'`),
    check(
      "votes_time_selection_consistent",
      sql`${table.availableAfter} is null or jsonb_array_length(${table.exactTimes}) = 0`,
    ),
    check("votes_source_valid", sql`${table.source} in (${voteSourceSql})`),
    check(
      "votes_source_update_consistent",
      sql`(
        (${table.source} = 'telegram_callback' and ${table.telegramUpdateId} is not null)
        or (${table.source} = 'owner_correction' and ${table.telegramUpdateId} is null)
      )`,
    ),
    uniqueIndex("votes_match_telegram_user_unique").on(table.matchId, table.telegramUserId),
    index("votes_match_option_idx").on(table.matchId, table.option),
    index("votes_player_idx").on(table.playerId),
  ],
);

export const externalParticipants = pgTable(
  "external_participants",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    matchId: bigint("match_id", { mode: "bigint" })
      .notNull()
      .references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    createdByTelegramUserId: bigint("created_by_telegram_user_id", { mode: "bigint" }).notNull(),
    sourceUpdateId: bigint("source_update_id", { mode: "bigint" }).references(
      () => telegramUpdates.updateId,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    displayName: text("display_name"),
    availableAfter: text("available_after"),
    quantity: integer("quantity").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "external_participants_created_by_positive",
      sql`${table.createdByTelegramUserId} > 0`,
    ),
    check(
      "external_participants_source_update_non_negative",
      sql`${table.sourceUpdateId} is null or ${table.sourceUpdateId} >= 0`,
    ),
    check("external_participants_quantity_is_one", sql`${table.quantity} = 1`),
    check(
      "external_participants_display_name_not_empty",
      sql`${table.displayName} is null or length(trim(${table.displayName})) > 0`,
    ),
    check(
      "external_participants_available_after_valid",
      sql`${table.availableAfter} is null or ${table.availableAfter} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    uniqueIndex("external_participants_source_update_unique")
      .on(table.sourceUpdateId)
      .where(sql`${table.sourceUpdateId} is not null`),
    index("external_participants_match_idx").on(table.matchId),
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
    check(
      "http_idempotency_key_not_empty",
      sql`length(trim(${table.idempotencyKey})) between 1 and 255`,
    ),
    check("http_idempotency_request_hash_not_empty", sql`length(trim(${table.requestHash})) > 0`),
    check(
      "http_idempotency_status_valid",
      sql`${table.status} in (${httpIdempotencyStatusSql})`,
    ),
    check(
      "http_idempotency_response_status_valid",
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
    check(
      "http_idempotency_completion_consistent",
      sql`(
        (${table.status} = 'processing' and ${table.completedAt} is null)
        or (${table.status} in ('succeeded', 'failed') and ${table.completedAt} is not null and ${table.responseStatus} is not null)
      )`,
    ),
    unique("http_idempotency_owner_key_unique").on(
      table.ownerTelegramUserId,
      table.idempotencyKey,
    ),
    index("http_idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    matchId: bigint("match_id", { mode: "bigint" }).references(() => matches.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    notificationType: text("notification_type", { enum: notificationTypes }).notNull(),
    transitionKey: text("transition_key").notNull(),
    weatherDay: date("weather_day", { mode: "string" }),
    deliveryState: text("delivery_state", { enum: notificationDeliveryStates })
      .notNull()
      .default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    uncertainAt: timestamp("uncertain_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("notifications_telegram_chat_id_non_zero", sql`${table.telegramChatId} <> 0`),
    check(
      "notifications_type_valid",
      sql`${table.notificationType} in (${notificationTypeSql})`,
    ),
    check("notifications_transition_key_not_empty", sql`length(trim(${table.transitionKey})) > 0`),
    check(
      "notifications_scope_consistent",
      sql`(
        (${table.notificationType} = 'weather_forecast' and ${table.matchId} is null and ${table.weatherDay} is not null)
        or (${table.notificationType} <> 'weather_forecast' and ${table.matchId} is not null and ${table.weatherDay} is null)
      )`,
    ),
    check(
      "notifications_delivery_state_valid",
      sql`${table.deliveryState} in (${notificationDeliveryStateSql})`,
    ),
    check(
      "notifications_delivery_timestamps_consistent",
      sql`(
        (${table.deliveryState} = 'sent' and ${table.sentAt} is not null and ${table.uncertainAt} is null)
        or (${table.deliveryState} = 'uncertain' and ${table.sentAt} is null and ${table.uncertainAt} is not null)
        or (${table.deliveryState} in ('pending', 'failed') and ${table.sentAt} is null and ${table.uncertainAt} is null)
      )`,
    ),
    uniqueIndex("notifications_match_type_transition_unique")
      .on(table.matchId, table.notificationType, table.transitionKey)
      .where(sql`${table.matchId} is not null`),
    uniqueIndex("notifications_weather_day_unique")
      .on(table.telegramChatId, table.weatherDay)
      .where(sql`${table.notificationType} = 'weather_forecast'`),
    index("notifications_match_idx").on(table.matchId, table.createdAt),
    index("notifications_delivery_idx").on(table.deliveryState, table.updatedAt),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    eventType: text("event_type", { enum: outboxEventTypes }).notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    matchId: bigint("match_id", { mode: "bigint" }).references(() => matches.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    notificationId: bigint("notification_id", { mode: "bigint" }).references(
      () => notifications.id,
      { onDelete: "cascade", onUpdate: "cascade" },
    ),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramTopicId: bigint("telegram_topic_id", { mode: "bigint" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    deliveryState: text("delivery_state", { enum: outboxDeliveryStates })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    uncertainAt: timestamp("uncertain_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("outbox_event_type_valid", sql`${table.eventType} in (${outboxEventTypeSql})`),
    check("outbox_deduplication_key_not_empty", sql`length(trim(${table.deduplicationKey})) > 0`),
    check("outbox_telegram_chat_id_non_zero", sql`${table.telegramChatId} <> 0`),
    check(
      "outbox_telegram_topic_id_positive",
      sql`${table.telegramTopicId} is null or ${table.telegramTopicId} > 0`,
    ),
    check("outbox_attempt_count_non_negative", sql`${table.attemptCount} >= 0`),
    check(
      "outbox_event_scope_consistent",
      sql`(
        (${table.eventType} = 'send_notification' and ${table.notificationId} is not null)
        or (${table.eventType} <> 'send_notification' and ${table.matchId} is not null)
      )`,
    ),
    check(
      "outbox_delivery_state_valid",
      sql`${table.deliveryState} in (${outboxDeliveryStateSql})`,
    ),
    check(
      "outbox_delivery_timestamps_consistent",
      sql`(
        (${table.deliveryState} = 'delivered' and ${table.deliveredAt} is not null and ${table.uncertainAt} is null)
        or (${table.deliveryState} = 'uncertain' and ${table.deliveredAt} is null and ${table.uncertainAt} is not null)
        or (${table.deliveryState} in ('pending', 'processing', 'failed') and ${table.deliveredAt} is null and ${table.uncertainAt} is null)
      )`,
    ),
    check(
      "outbox_error_consistent",
      sql`(
        (${table.deliveryState} in ('failed', 'uncertain') and ${table.lastError} is not null and length(trim(${table.lastError})) > 0)
        or (${table.deliveryState} in ('pending', 'processing', 'delivered') and ${table.lastError} is null)
      )`,
    ),
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
    check(
      "job_claims_error_not_empty",
      sql`${table.lastError} is null or length(trim(${table.lastError})) > 0`,
    ),
  ],
);

export const matchesRelations = relations(matches, ({ one, many }) => ({
  venue: one(venues, {
    fields: [matches.venueId],
    references: [venues.id],
  }),
  publicCard: one(matchMessages),
  votes: many(votes),
  externalParticipants: many(externalParticipants),
  notifications: many(notifications),
  outbox: many(outbox),
}));

export const venuesRelations = relations(venues, ({ many }) => ({
  matches: many(matches),
}));

export const playersRelations = relations(players, ({ many }) => ({
  usernames: many(playerUsernames),
  votes: many(votes),
}));

export const playerUsernamesRelations = relations(playerUsernames, ({ one }) => ({
  player: one(players, {
    fields: [playerUsernames.playerId],
    references: [players.id],
  }),
}));

export const matchMessagesRelations = relations(matchMessages, ({ one }) => ({
  match: one(matches, {
    fields: [matchMessages.matchId],
    references: [matches.id],
  }),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  match: one(matches, {
    fields: [votes.matchId],
    references: [matches.id],
  }),
  player: one(players, {
    fields: [votes.playerId],
    references: [players.id],
  }),
  telegramUpdate: one(telegramUpdates, {
    fields: [votes.telegramUpdateId],
    references: [telegramUpdates.updateId],
  }),
}));

export const externalParticipantsRelations = relations(externalParticipants, ({ one }) => ({
  match: one(matches, {
    fields: [externalParticipants.matchId],
    references: [matches.id],
  }),
  sourceUpdate: one(telegramUpdates, {
    fields: [externalParticipants.sourceUpdateId],
    references: [telegramUpdates.updateId],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one, many }) => ({
  match: one(matches, {
    fields: [notifications.matchId],
    references: [matches.id],
  }),
  outbox: many(outbox),
}));

export const outboxRelations = relations(outbox, ({ one }) => ({
  match: one(matches, {
    fields: [outbox.matchId],
    references: [matches.id],
  }),
  notification: one(notifications, {
    fields: [outbox.notificationId],
    references: [notifications.id],
  }),
}));

export type TelegramUpdate = typeof telegramUpdates.$inferSelect;
export type NewTelegramUpdate = typeof telegramUpdates.$inferInsert;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type PlayerUsername = typeof playerUsernames.$inferSelect;
export type NewPlayerUsername = typeof playerUsernames.$inferInsert;
export type MatchMessage = typeof matchMessages.$inferSelect;
export type NewMatchMessage = typeof matchMessages.$inferInsert;
export type Vote = typeof votes.$inferSelect;
export type NewVote = typeof votes.$inferInsert;
export type ExternalParticipant = typeof externalParticipants.$inferSelect;
export type NewExternalParticipant = typeof externalParticipants.$inferInsert;
export type HttpIdempotencyKey = typeof httpIdempotencyKeys.$inferSelect;
export type NewHttpIdempotencyKey = typeof httpIdempotencyKeys.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type OutboxEvent = typeof outbox.$inferSelect;
export type NewOutboxEvent = typeof outbox.$inferInsert;
export type JobClaim = typeof jobClaims.$inferSelect;
export type NewJobClaim = typeof jobClaims.$inferInsert;

export const schema = {
  telegramUpdates,
  players,
  venues,
  matches,
  playerUsernames,
  matchMessages,
  votes,
  externalParticipants,
  httpIdempotencyKeys,
  notifications,
  outbox,
  jobClaims,
};

export type DatabaseSchema = typeof schema;
