import type { AppDatabase } from "../client.js";

import {
  ChatSettingsRepository,
  createChatSettingsRepository,
} from "./chat-settings.js";
import { createMatchesRepository, MatchesRepository } from "./matches.js";
import { createMatchMessagesRepository, MatchMessagesRepository } from "./match-messages.js";
import { createMatchActionsRepository, MatchActionsRepository } from "./match-actions.js";
import { createNotificationsRepository, NotificationsRepository } from "./notifications.js";
import {
  createProcessedUpdatesRepository,
  ProcessedUpdatesRepository,
} from "./processed-updates.js";
import { createVotesRepository, VotesRepository } from "./votes.js";
import {
  createExternalParticipantsRepository,
  ExternalParticipantsRepository,
} from "./external-participants.js";

export {
  ChatSettingsRepository,
  MatchesRepository,
  MatchActionsRepository,
  MatchMessagesRepository,
  NotificationsRepository,
  ProcessedUpdatesRepository,
  VotesRepository,
  ExternalParticipantsRepository,
};
export * from "./chat-settings.js";
export * from "./matches.js";
export * from "./match-actions.js";
export * from "./match-messages.js";
export * from "./notifications.js";
export * from "./processed-updates.js";
export * from "./votes.js";
export * from "./external-participants.js";

export interface Repositories {
  chatSettings: ChatSettingsRepository;
  matches: MatchesRepository;
  matchActions: MatchActionsRepository;
  matchMessages: MatchMessagesRepository;
  processedUpdates: ProcessedUpdatesRepository;
  votes: VotesRepository;
  externalParticipants: ExternalParticipantsRepository;
  notifications: NotificationsRepository;
}

export function createRepositories(db: AppDatabase): Repositories {
  return {
    chatSettings: createChatSettingsRepository(db),
    matches: createMatchesRepository(db),
    matchActions: createMatchActionsRepository(db),
    matchMessages: createMatchMessagesRepository(db),
    processedUpdates: createProcessedUpdatesRepository(db),
    votes: createVotesRepository(db),
    externalParticipants: createExternalParticipantsRepository(db),
    notifications: createNotificationsRepository(db),
  };
}
