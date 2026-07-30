/** A database identifier represented without tying the domain to one driver. */
export type DomainId = string | number | bigint;

export type MatchId = DomainId;
export type TelegramChatId = DomainId;
export type TelegramUserId = DomainId;
export type ExternalParticipantId = DomainId;

export const matchStatuses = [
  "draft",
  "active",
  "confirmed",
  "completed",
  "cancelled",
] as const;

export type MatchStatus = (typeof matchStatuses)[number];

export const venueTypes = ["outdoor", "indoor"] as const;

export type VenueType = (typeof venueTypes)[number];

export const matchTimeModes = ["exact", "availability"] as const;

export type MatchTimeMode = (typeof matchTimeModes)[number];

export const voteOptions = ["going", "not_going", "maybe"] as const;

export type VoteOption = (typeof voteOptions)[number];
export type VoteChoice = VoteOption | null;

export const notificationTypes = [
  "threshold_reached",
  "threshold_lost",
  "withdrawal",
  "match_confirmed",
  "match_cancelled",
  "weather_forecast",
] as const;

export type NotificationType = (typeof notificationTypes)[number];

export interface Match {
  readonly id: MatchId;
  readonly chatId: TelegramChatId;
  readonly scheduledAt: Date | null;
  /** Local calendar date is stored separately while availability voting has no final time. */
  readonly scheduleDate?: string | null;
  readonly timeMode?: MatchTimeMode;
  readonly timeOptions?: readonly string[];
  readonly selectedTime?: string | null;
  readonly location: string | null;
  readonly venueType: VenueType | null;
  readonly fieldPriceRubles: number | null;
  readonly title: string | null;
  /** The minimum roster size; it is not a capacity limit. */
  readonly requiredPlayers: number;
  readonly status: MatchStatus;
  readonly cancellationReason: string | null;
  readonly creatorTelegramUserId: TelegramUserId;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface Vote {
  readonly matchId: MatchId;
  readonly telegramUserId: TelegramUserId;
  readonly usernameSnapshot: string | null;
  readonly displayNameSnapshot: string;
  readonly option: VoteOption;
  /** Earliest local time the player can attend in availability mode. */
  readonly availableAfter?: string | null;
  readonly updatedAt?: Date;
}

export interface ExternalParticipant {
  readonly id?: ExternalParticipantId;
  readonly matchId: MatchId;
  readonly addedByTelegramUserId: TelegramUserId;
  readonly sourceUpdateId?: DomainId;
  readonly sourceLabel: string | null;
  readonly displayNameSnapshot: string | null;
  /** Ledger entries may be negative when the owner removes quantities. */
  readonly quantity: number;
  readonly createdAt?: Date;
}

export interface MatchDraft {
  readonly date: string;
  readonly time: string | null;
  readonly timeMode?: MatchTimeMode;
  readonly timeOptions?: readonly string[];
  readonly location: string | null;
  readonly venueType: VenueType | null;
  readonly requiredPlayers: number;
  readonly fieldPriceRubles?: number | null;
  readonly dateLabel?: string;
  readonly timeLabel?: string;
}

export interface RosterCounts {
  readonly goingVotes: number;
  readonly externalParticipants: number;
  readonly goingCount: number;
  readonly requiredPlayers: number;
  /** Reaching this value is sufficient; values above it remain valid. */
  readonly thresholdReached: boolean;
  readonly remainingToThreshold: number;
}

export interface NotificationTransition {
  readonly matchId: MatchId;
  readonly notificationType: NotificationType;
  readonly transitionKey: string;
}

export interface WeatherForecast {
  readonly forecastTime: string;
  readonly temperatureCelsius: number;
  readonly apparentTemperatureCelsius: number;
  readonly precipitationProbability: number;
  readonly precipitationMillimetres: number;
  readonly weatherCode: number;
  readonly windSpeedMetresPerSecond: number;
  readonly windGustsMetresPerSecond: number;
}
