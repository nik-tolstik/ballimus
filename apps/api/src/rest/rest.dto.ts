import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Max,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { venueTypes } from "@football/domain";

const DECIMAL_ID_PATTERN = /^[1-9]\d*$/u;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]{4,48}$/u;

export class PollOptionCreateDto {
  @ApiProperty({ type: String, example: "Буду играть", minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  text!: string;

  @ApiProperty({ type: Boolean, default: true })
  @IsBoolean()
  notificationEnabled!: boolean;
}

export class PollCreateDto {
  @ApiProperty({ type: String, example: "Кто играет в воскресенье?", minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question!: string;

  @ApiProperty({ type: [PollOptionCreateDto], minItems: 2, maxItems: 12 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PollOptionCreateDto)
  options!: PollOptionCreateDto[];

  @ApiPropertyOptional({ type: Number, nullable: true, default: null, example: 10, minimum: 1, maximum: 1_000_000 })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  notificationThreshold?: number | null;

  @ApiProperty({ type: Boolean, default: false })
  @IsBoolean()
  allowsMultipleAnswers!: boolean;
}

export class MatchCreateDto {
  @ApiProperty({ type: String, example: "2026-08-03", pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  date!: string;

  @ApiProperty({ type: String, example: "20:00", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" })
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  time!: string;

  @ApiProperty({ type: Number, example: 90, minimum: 15, maximum: 480 })
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes!: number;

  @ApiProperty({ type: String, example: "15", pattern: "^[1-9]\\d*$" })
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  venueId!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 25, minimum: 0 })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fieldPriceRubles?: number | null;
}

export class PatchMatchDto {
  @ApiPropertyOptional({ type: String, example: "2026-08-03", pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  date?: string;

  @ApiPropertyOptional({ type: String, example: "20:00", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  time?: string;

  @ApiPropertyOptional({ type: Number, example: 90, minimum: 15, maximum: 480 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes?: number;

  @ApiPropertyOptional({ type: String, example: "15", pattern: "^[1-9]\\d*$" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  venueId?: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 25, minimum: 0 })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fieldPriceRubles?: number | null;
}

export class MatchListQueryDto {
  @ApiPropertyOptional({ type: String, example: "15", pattern: "^[1-9]\\d*$" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  venueId?: string;
}

export class VenueBookingContactDto {
  @ApiPropertyOptional({ type: String, example: "Администратор" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ type: String, example: "+375 29 123-45-67" })
  @IsString()
  @Matches(PHONE_PATTERN)
  phone!: string;
}

export class VenueCreateDto {
  @ApiProperty({ type: String, example: "BOX365 Октябрьская" })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ type: String, format: "uri", example: "https://maps.google.com/?q=53.9,27.56" })
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(2_000)
  mapUrl!: string;

  @ApiProperty({ enum: venueTypes, example: "indoor" })
  @IsIn(venueTypes)
  venueType!: (typeof venueTypes)[number];

  @ApiPropertyOptional({ type: [VenueBookingContactDto], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => VenueBookingContactDto)
  bookingContacts?: VenueBookingContactDto[];

  @ApiPropertyOptional({ type: String, nullable: true, format: "uri" })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(2_000)
  websiteUrl?: string | null;
}

export class VenueUpdateDto {
  @ApiPropertyOptional({ type: String, example: "BOX365 Октябрьская" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ type: String, format: "uri" })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(2_000)
  mapUrl?: string;

  @ApiPropertyOptional({ enum: venueTypes })
  @IsOptional()
  @IsIn(venueTypes)
  venueType?: (typeof venueTypes)[number];

  @ApiPropertyOptional({ type: [VenueBookingContactDto], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => VenueBookingContactDto)
  bookingContacts?: VenueBookingContactDto[];

  @ApiPropertyOptional({ type: String, nullable: true, format: "uri" })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(2_000)
  websiteUrl?: string | null;
}
