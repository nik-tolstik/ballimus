import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const MATCH_STATUSES = ["draft", "active", "confirmed", "completed", "cancelled"] as const;
const MATCH_PLANNING_STAGES = ["recruiting_players", "finalizing_details", "ready_to_confirm"] as const;
const VOTE_OPTIONS = ["going", "not_going", "maybe"] as const;
const PUBLICATION_STATES = ["not_published", "pending", "published", "uncertain", "failed", "deleted"] as const;

export class OwnerIdentityResponseDto {
  @ApiProperty({ type: String, example: "123456789" })
  telegramUserId!: string;
}

export class GroupConfigurationResponseDto {
  @ApiProperty({ type: String, example: "-1001234567890" })
  telegramChatId!: string;

  @ApiProperty({ type: String, example: "1" })
  generalTopicId!: string;

  @ApiProperty({ type: String, example: "42" })
  chatTopicId!: string;
}

export class MatchScheduleResponseDto {
  @ApiProperty({ type: String, nullable: true, example: "2026-08-03" })
  date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "20:00" })
  time!: string | null;

  @ApiProperty({ type: String, example: "Europe/Minsk" })
  timezone!: string;
}

export class RosterCountsResponseDto {
  @ApiProperty({ type: Number })
  goingVotes!: number;

  @ApiProperty({ type: Number })
  externalParticipants!: number;

  @ApiProperty({ type: Number })
  goingCount!: number;

  @ApiProperty({ type: Number })
  requiredPlayers!: number;

  @ApiProperty({ type: Boolean })
  thresholdReached!: boolean;

  @ApiProperty({ type: Number })
  remainingToThreshold!: number;
}

export class MatchVoteResponseDto {
  @ApiProperty({ type: String, example: "12" })
  playerId!: string;

  @ApiProperty({ type: String, example: "123456789" })
  telegramUserId!: string;

  @ApiProperty({ type: String, nullable: true, example: "footballer" })
  username!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "Алексей" })
  readableName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
  })
  avatarUrl!: string | null;

  @ApiProperty({ type: String, enum: VOTE_OPTIONS })
  option!: (typeof VOTE_OPTIONS)[number];

  @ApiProperty({ type: String, nullable: true, example: "19:00" })
  availableAfter!: string | null;

  @ApiProperty({ type: [String], example: ["19:00", "20:00"] })
  exactTimes!: string[];

  @ApiProperty({ type: String, enum: ["telegram_callback", "owner_correction"] })
  source!: "telegram_callback" | "owner_correction";

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  updatedAt!: string | null;
}

export class ExternalParticipantResponseDto {
  @ApiProperty({ type: String, example: "8" })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: "Команда Никиты" })
  displayName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "19:00" })
  availableAfter!: string | null;

  @ApiProperty({ type: Number, minimum: 1 })
  quantity!: number;

  @ApiProperty({ type: String, example: "123456789" })
  createdByTelegramUserId!: string;

  @ApiProperty({ type: String, nullable: true })
  sourceUpdateId!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  createdAt!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  updatedAt!: string | null;
}

export class MatchRosterResponseDto {
  @ApiProperty({ type: RosterCountsResponseDto })
  counts!: RosterCountsResponseDto;

  @ApiProperty({ type: [MatchVoteResponseDto] })
  votes!: MatchVoteResponseDto[];

  @ApiProperty({ type: [ExternalParticipantResponseDto] })
  externalParticipants!: ExternalParticipantResponseDto[];
}

export class PublicCardResponseDto {
  @ApiProperty({ type: String, enum: PUBLICATION_STATES })
  publicationState!: (typeof PUBLICATION_STATES)[number];

  @ApiProperty({ type: String, enum: ["none", "pending", "uncertain", "failed"] })
  reconciliationState!: "none" | "pending" | "uncertain" | "failed";

  @ApiProperty({ type: Boolean })
  reconciliationRequired!: boolean;

  @ApiProperty({ type: String, nullable: true })
  telegramChatId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  telegramTopicId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  telegramMessageId!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  publicationAttemptedAt!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  publicationUncertainAt!: string | null;
}

export class VenueBookingContactResponseDto {
  @ApiPropertyOptional({ type: String })
  name?: string;

  @ApiProperty({ type: String })
  phone!: string;
}

export class VenueResponseDto {
  @ApiProperty({ type: String, example: "15" })
  id!: string;

  @ApiProperty({ type: String, example: "BOX365 Октябрьская" })
  name!: string;

  @ApiProperty({ type: String, format: "uri" })
  mapUrl!: string;

  @ApiProperty({ type: String, enum: ["outdoor", "indoor"] })
  venueType!: "outdoor" | "indoor";

  @ApiProperty({ type: [VenueBookingContactResponseDto] })
  bookingContacts!: VenueBookingContactResponseDto[];

  @ApiProperty({ type: String, nullable: true, format: "uri" })
  websiteUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  archivedAt!: string | null;

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: string;
}

export class VenueListResponseDto {
  @ApiProperty({ type: [VenueResponseDto] })
  venues!: VenueResponseDto[];
}

export class VenueEnvelopeResponseDto {
  @ApiProperty({ type: VenueResponseDto })
  venue!: VenueResponseDto;
}

export class MatchResponseDto {
  @ApiProperty({ type: String, example: "42" })
  id!: string;

  @ApiProperty({ type: String, example: "-1001234567890" })
  chatId!: string;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  scheduledAt!: string | null;

  @ApiProperty({ type: String, enum: ["exact", "exact_options", "availability"] })
  timeMode!: "exact" | "exact_options" | "availability";

  @ApiProperty({ type: [String], example: ["19:00", "20:00"] })
  timeOptions!: string[];

  @ApiProperty({ type: String, nullable: true, example: "20:00" })
  selectedTime!: string | null;

  @ApiProperty({ type: MatchScheduleResponseDto })
  schedule!: MatchScheduleResponseDto;

  @ApiProperty({ type: String, nullable: true })
  location!: string | null;

  @ApiProperty({ type: String, enum: ["outdoor", "indoor"], nullable: true })
  venueType!: "outdoor" | "indoor" | null;

  @ApiProperty({ type: VenueResponseDto, nullable: true })
  venue!: VenueResponseDto | null;

  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  fieldPriceRubles!: number | null;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: String })
  displayTitle!: string;

  @ApiProperty({ type: Number, minimum: 1 })
  requiredPlayers!: number;

  @ApiProperty({ type: String, enum: MATCH_STATUSES })
  status!: (typeof MATCH_STATUSES)[number];

  @ApiProperty({ type: String, enum: MATCH_PLANNING_STAGES, nullable: true })
  planningStage!: (typeof MATCH_PLANNING_STAGES)[number] | null;

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ type: String })
  creatorTelegramUserId!: string;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  createdAt!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  updatedAt!: string | null;

  @ApiProperty({ type: MatchRosterResponseDto })
  roster!: MatchRosterResponseDto;

  @ApiProperty({ type: PublicCardResponseDto })
  publicCard!: PublicCardResponseDto;
}

export class GroupedMatchesResponseDto {
  @ApiProperty({ type: [MatchResponseDto] })
  drafts!: MatchResponseDto[];

  @ApiProperty({ type: [MatchResponseDto] })
  active!: MatchResponseDto[];

  @ApiProperty({ type: [MatchResponseDto] })
  confirmed!: MatchResponseDto[];

  @ApiProperty({ type: [MatchResponseDto] })
  history!: MatchResponseDto[];
}

export class BootstrapResponseDto {
  @ApiProperty({ type: OwnerIdentityResponseDto })
  owner!: OwnerIdentityResponseDto;

  @ApiProperty({ type: GroupConfigurationResponseDto })
  group!: GroupConfigurationResponseDto;

  @ApiProperty({ type: String })
  timezone!: string;

  @ApiProperty({ type: GroupedMatchesResponseDto })
  matches!: GroupedMatchesResponseDto;
}

export class MatchListResponseDto {
  @ApiProperty({ type: [MatchResponseDto] })
  matches!: MatchResponseDto[];
}

export class MatchEnvelopeResponseDto {
  @ApiProperty({ type: MatchResponseDto })
  match!: MatchResponseDto;
}

export class MutationActionResponseDto {
  @ApiProperty({ type: String })
  type!: string;

  @ApiPropertyOptional({ type: String, enum: ["none", "pending"] })
  outboxState?: "none" | "pending";

  @ApiPropertyOptional({ type: String })
  eventType?: string;
}

export class MatchMutationResponseDto extends MatchEnvelopeResponseDto {
  @ApiPropertyOptional({ type: MutationActionResponseDto })
  action?: MutationActionResponseDto;
}

export class CardPreviewBodyResponseDto {
  @ApiProperty({ type: String })
  text!: string;

  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class CardPreviewResponseDto {
  @ApiProperty({ type: String })
  matchId!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: CardPreviewBodyResponseDto })
  card!: CardPreviewBodyResponseDto;
}

export class WeatherSendResponseDto {
  @ApiProperty({ type: String })
  matchId!: string;

  @ApiProperty({ type: String, format: "date" })
  weatherDay!: string;

  @ApiProperty({ type: String, enum: ["sent"] })
  status!: "sent";
}

export class PlayerUsernameResponseDto {
  @ApiProperty({ type: String })
  normalizedUsername!: string;

  @ApiProperty({ type: String, example: "@footballer" })
  username!: string;

  @ApiProperty({ type: String })
  playerId!: string;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  lastSeenAt!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  createdAt!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  updatedAt!: string | null;
}

export class PlayerResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  telegramUserId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
  })
  avatarUrl!: string | null;

  @ApiProperty({ type: Boolean })
  confirmed!: boolean;

  @ApiProperty({ type: String, enum: ["confirmed", "unconfirmed"] })
  confirmationState!: "confirmed" | "unconfirmed";

  @ApiProperty({ type: String, nullable: true })
  telegramUsernameSnapshot!: string | null;

  @ApiProperty({ type: String, nullable: true })
  telegramFirstNameSnapshot!: string | null;

  @ApiProperty({ type: String, nullable: true })
  telegramLastNameSnapshot!: string | null;

  @ApiProperty({ type: String, nullable: true })
  telegramLanguageCode!: string | null;

  @ApiProperty({ type: [PlayerUsernameResponseDto] })
  usernames!: PlayerUsernameResponseDto[];
}

export class PlayerListResponseDto {
  @ApiProperty({ type: [PlayerResponseDto] })
  players!: PlayerResponseDto[];
}

export class PlayerEnvelopeResponseDto {
  @ApiProperty({ type: PlayerResponseDto })
  player!: PlayerResponseDto;
}

export class AliasMutationResponseDto extends PlayerEnvelopeResponseDto {
  @ApiProperty({ type: PlayerUsernameResponseDto })
  alias!: PlayerUsernameResponseDto;
}

export class AliasRemovalResponseDto {
  @ApiProperty({ type: String })
  username!: string;

  @ApiProperty({ type: Boolean, example: true })
  removed!: boolean;

  @ApiProperty({ type: String, enum: ["unconfirmed"] })
  confirmationState!: "unconfirmed";
}
