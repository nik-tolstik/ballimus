import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const matchStatuses = ["draft", "active", "confirmed", "completed", "cancelled"] as const;
export type MatchStatus = (typeof matchStatuses)[number];

export const voteOptions = ["going", "not_going", "maybe"] as const;
export type VoteOption = (typeof voteOptions)[number];

export const matchMessageKinds = ["public_card", "admin_panel"] as const;
export type MatchMessageKind = (typeof matchMessageKinds)[number];

export const notificationTypes = [
  "threshold_reached",
  "withdrawal",
  "match_confirmed",
  "match_cancelled",
] as const;
export type NotificationType = (typeof notificationTypes)[number];

const matchStatusSql = sql.join(
  matchStatuses.map((status) => sql.raw(`'${status}'`)),
  sql`, `,
);
const voteOptionSql = sql.join(
  voteOptions.map((option) => sql.raw(`'${option}'`)),
  sql`, `,
);
const matchMessageKindSql = sql.join(
  matchMessageKinds.map((kind) => sql.raw(`'${kind}'`)),
  sql`, `,
);
const notificationTypeSql = sql.join(
  notificationTypes.map((type) => sql.raw(`'${type}'`)),
  sql`, `,
);

export const chatSettings = sqliteTable(
  "chat_settings",
  {
    chatId: integer("chat_id").primaryKey(),
    generalTopicId: integer("general_topic_id"),
    chatTopicId: integer("chat_topic_id"),
    timezone: text("timezone").notNull(),
    defaultThreshold: integer("default_threshold").notNull().default(10),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("chat_settings_default_threshold_positive", sql`${table.defaultThreshold} >= 1`),
    index("chat_settings_chat_topic_idx").on(table.chatTopicId),
  ],
);

export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chatSettings.chatId, { onDelete: "restrict", onUpdate: "cascade" }),
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
    location: text("location"),
    fieldPriceRubles: integer("field_price_rubles"),
    title: text("title"),
    requiredPlayers: integer("required_players").notNull(),
    status: text("status", { enum: matchStatuses }).notNull().default("draft"),
    creatorTelegramUserId: integer("creator_telegram_user_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("matches_required_players_positive", sql`${table.requiredPlayers} >= 1`),
    check(
      "matches_location_not_empty",
      sql`${table.location} is null or length(trim(${table.location})) > 0`,
    ),
    check(
      "matches_field_price_non_negative",
      sql`${table.fieldPriceRubles} is null or ${table.fieldPriceRubles} >= 0`,
    ),
    check("matches_status_valid", sql`${table.status} in (${matchStatusSql})`),
    uniqueIndex("matches_id_chat_unique").on(table.id, table.chatId),
    index("matches_chat_status_idx").on(table.chatId, table.status),
    index("matches_scheduled_at_idx").on(table.scheduledAt),
  ],
);

export const matchMessages = sqliteTable(
  "match_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    kind: text("kind", { enum: matchMessageKinds }).notNull(),
    messageId: integer("message_id").notNull(),
    chatId: integer("chat_id").notNull(),
    topicId: integer("topic_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("match_messages_kind_valid", sql`${table.kind} in (${matchMessageKindSql})`),
    check("match_messages_message_id_positive", sql`${table.messageId} > 0`),
    uniqueIndex("match_messages_match_kind_unique").on(table.matchId, table.kind),
    index("match_messages_chat_topic_idx").on(table.chatId, table.topicId),
  ],
);

export const processedUpdates = sqliteTable(
  "processed_updates",
  {
    updateId: integer("update_id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    action: text("action").notNull(),
    telegramUserId: integer("telegram_user_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("processed_updates_update_id_non_negative", sql`${table.updateId} >= 0`),
    index("processed_updates_match_idx").on(table.matchId),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    telegramUserId: integer("telegram_user_id").notNull(),
    usernameSnapshot: text("username_snapshot"),
    displayNameSnapshot: text("display_name_snapshot").notNull(),
    option: text("option", { enum: voteOptions }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.telegramUserId] }),
    check("votes_option_valid", sql`${table.option} in (${voteOptionSql})`),
    index("votes_match_option_idx").on(table.matchId, table.option),
    index("votes_telegram_user_idx").on(table.telegramUserId),
  ],
);

export const externalParticipants = sqliteTable(
  "external_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    addedByTelegramUserId: integer("added_by_telegram_user_id").notNull(),
    sourceUpdateId: integer("source_update_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("external_participants_source_update_non_negative", sql`${table.sourceUpdateId} >= 0`),
    check("external_participants_quantity_non_zero", sql`${table.quantity} <> 0`),
    uniqueIndex("external_participants_source_update_unique").on(table.sourceUpdateId),
    index("external_participants_match_idx").on(table.matchId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade", onUpdate: "cascade" }),
    notificationType: text("notification_type", { enum: notificationTypes }).notNull(),
    transitionKey: text("transition_key").notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("notifications_idempotency_key").on(
      table.matchId,
      table.notificationType,
      table.transitionKey,
    ),
    check("notifications_type_valid", sql`${table.notificationType} in (${notificationTypeSql})`),
    index("notifications_match_idx").on(table.matchId),
  ],
);

export const chatSettingsRelations = relations(chatSettings, ({ many }) => ({
  matches: many(matches),
  matchMessages: many(matchMessages),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  chat: one(chatSettings, {
    fields: [matches.chatId],
    references: [chatSettings.chatId],
  }),
  messages: many(matchMessages),
  votes: many(votes),
  externalParticipants: many(externalParticipants),
  notifications: many(notifications),
  processedUpdates: many(processedUpdates),
}));

export const matchMessagesRelations = relations(matchMessages, ({ one }) => ({
  match: one(matches, {
    fields: [matchMessages.matchId],
    references: [matches.id],
  }),
}));

export const processedUpdatesRelations = relations(processedUpdates, ({ one }) => ({
  match: one(matches, {
    fields: [processedUpdates.matchId],
    references: [matches.id],
  }),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  match: one(matches, {
    fields: [votes.matchId],
    references: [matches.id],
  }),
}));

export const externalParticipantsRelations = relations(externalParticipants, ({ one }) => ({
  match: one(matches, {
    fields: [externalParticipants.matchId],
    references: [matches.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  match: one(matches, {
    fields: [notifications.matchId],
    references: [matches.id],
  }),
}));

export type ChatSettings = typeof chatSettings.$inferSelect;
export type NewChatSettings = typeof chatSettings.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchMessage = typeof matchMessages.$inferSelect;
export type NewMatchMessage = typeof matchMessages.$inferInsert;
export type ProcessedUpdate = typeof processedUpdates.$inferSelect;
export type NewProcessedUpdate = typeof processedUpdates.$inferInsert;
export type Vote = typeof votes.$inferSelect;
export type NewVote = typeof votes.$inferInsert;
export type ExternalParticipant = typeof externalParticipants.$inferSelect;
export type NewExternalParticipant = typeof externalParticipants.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export const schema = {
  chatSettings,
  matches,
  matchMessages,
  processedUpdates,
  votes,
  externalParticipants,
  notifications,
  chatSettingsRelations,
  matchesRelations,
  matchMessagesRelations,
  processedUpdatesRelations,
  votesRelations,
  externalParticipantsRelations,
  notificationsRelations,
};
