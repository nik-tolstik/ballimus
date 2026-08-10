/** A database identifier represented without tying the domain to one driver. */
export type DomainId = string | number | bigint;

export type MatchId = DomainId;
export type TelegramChatId = DomainId;
export type TelegramUserId = DomainId;

export const venueTypes = ["outdoor", "indoor"] as const;
export type VenueType = (typeof venueTypes)[number];

export interface Match {
  readonly id: MatchId;
  readonly chatId: TelegramChatId;
  readonly scheduledAt: Date;
  readonly venueId: DomainId;
  readonly fieldPriceRubles: number | null;
  readonly creatorTelegramUserId: TelegramUserId;
  readonly deletionRequestedAt: Date | null;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface Venue {
  readonly id: DomainId;
  readonly name: string;
  readonly mapUrl: string;
  readonly venueType: VenueType;
}

export interface CurrentWeather {
  readonly observedAt: string;
  readonly temperatureCelsius: number;
  readonly apparentTemperatureCelsius: number;
  readonly precipitationMillimetres: number;
  readonly weatherCode: number;
  readonly windSpeedMetresPerSecond: number;
  readonly windGustsMetresPerSecond: number;
}
