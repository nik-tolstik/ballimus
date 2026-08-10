import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

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
  weatherTopicId!: string;

  @ApiProperty({ type: String, example: "Europe/Minsk" })
  timezone!: string;
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

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, format: "uri" })
  mapUrl!: string;

  @ApiProperty({ enum: ["outdoor", "indoor"] })
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

export class PublicCardResponseDto {
  @ApiProperty({ enum: ["not_published", "pending", "published", "uncertain", "failed", "deleted"] })
  publicationState!: "not_published" | "pending" | "published" | "uncertain" | "failed" | "deleted";

  @ApiProperty({ type: String, nullable: true })
  telegramMessageId!: string | null;

  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  publicationAttemptedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastError!: string | null;
}

export class MatchScheduleResponseDto {
  @ApiProperty({ type: String, example: "2026-08-03" })
  date!: string;

  @ApiProperty({ type: String, example: "20:00" })
  time!: string;

  @ApiProperty({ type: String, example: "Europe/Minsk" })
  timezone!: string;
}

export class MatchResponseDto {
  @ApiProperty({ type: String, example: "42" })
  id!: string;

  @ApiProperty({ type: String, example: "-1001234567890" })
  chatId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  scheduledAt!: string;

  @ApiProperty({ type: MatchScheduleResponseDto })
  schedule!: MatchScheduleResponseDto;

  @ApiProperty({ type: VenueResponseDto })
  venue!: VenueResponseDto;

  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  fieldPriceRubles!: number | null;

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, example: "123456789" })
  creatorTelegramUserId!: string;

  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  deletionRequestedAt!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: string;

  @ApiProperty({ type: PublicCardResponseDto })
  publicCard!: PublicCardResponseDto;
}

export class MatchEnvelopeResponseDto {
  @ApiProperty({ type: MatchResponseDto })
  match!: MatchResponseDto;
}

export class MatchListResponseDto {
  @ApiProperty({ type: [MatchResponseDto] })
  matches!: MatchResponseDto[];
}

export class VenueEnvelopeResponseDto {
  @ApiProperty({ type: VenueResponseDto })
  venue!: VenueResponseDto;
}

export class VenueListResponseDto {
  @ApiProperty({ type: [VenueResponseDto] })
  venues!: VenueResponseDto[];
}

export class BootstrapResponseDto {
  @ApiProperty({ type: OwnerIdentityResponseDto })
  owner!: OwnerIdentityResponseDto;

  @ApiProperty({ type: GroupConfigurationResponseDto })
  group!: GroupConfigurationResponseDto;

  @ApiProperty({ type: [MatchResponseDto] })
  matches!: MatchResponseDto[];
}

export class WeatherCurrentResponseDto {
  @ApiProperty({ type: Boolean, example: true })
  sent!: boolean;

  @ApiProperty({ type: String, example: "2026-08-10T11:00" })
  observedAt!: string;
}
