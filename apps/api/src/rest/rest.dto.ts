import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { matchStatuses, matchTimeModes, venueTypes, voteOptions } from "@football/domain";
import { MAX_EXTERNAL_PARTICIPANTS_PER_OPERATION } from "@football/db";

const DECIMAL_ID_PATTERN = /^[1-9]\d*$/u;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const USERNAME_PATTERN = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/u;

export class MatchCreateDto {
  @ApiProperty({ type: String, example: "2026-08-03", pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  date!: string;

  @ApiProperty({ type: String, nullable: true, example: "20:00", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  time!: string | null;

  @ApiPropertyOptional({ type: String, enum: matchTimeModes, default: "exact" })
  @IsOptional()
  @IsIn(matchTimeModes)
  timeMode?: (typeof matchTimeModes)[number];

  @ApiPropertyOptional({ type: [String], example: ["19:00", "20:00"], minItems: 2, maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @Matches(LOCAL_TIME_PATTERN, { each: true })
  timeOptions?: string[];

  @ApiProperty({ type: String, nullable: true, example: "BOX365 <main>" })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location!: string | null;

  @ApiPropertyOptional({ type: String, enum: venueTypes, nullable: true, example: "outdoor" })
  @IsOptional()
  @IsIn(venueTypes)
  venueType?: (typeof venueTypes)[number] | null;

  @ApiProperty({ type: Number, example: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  requiredPlayers!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 25, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fieldPriceRubles?: number | null;

  @ApiPropertyOptional({ type: String, example: "Пн" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dateLabel?: string;

  @ApiPropertyOptional({ type: String, example: "вечер" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timeLabel?: string;
}

export class PatchMatchDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: "2026-08-03" })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @Matches(CALENDAR_DATE_PATTERN)
  date?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: "20:00" })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  time?: string | null;

  @ApiPropertyOptional({ type: String, enum: matchTimeModes })
  @IsOptional()
  @IsIn(matchTimeModes)
  timeMode?: (typeof matchTimeModes)[number];

  @ApiPropertyOptional({ type: [String], minItems: 2, maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @Matches(LOCAL_TIME_PATTERN, { each: true })
  timeOptions?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, example: "BOX365 <main>" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location?: string | null;

  @ApiPropertyOptional({ type: String, enum: venueTypes, nullable: true })
  @IsOptional()
  @IsIn(venueTypes)
  venueType?: (typeof venueTypes)[number] | null;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  requiredPlayers?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fieldPriceRubles?: number | null;
}

export class MatchListQueryDto {
  @ApiPropertyOptional({ type: String, enum: matchStatuses })
  @IsOptional()
  @IsIn(matchStatuses)
  status?: (typeof matchStatuses)[number];

  @ApiPropertyOptional({ type: String, example: "BOX365" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CancelMatchDto {
  @ApiProperty({ type: String, example: "Плохая погода", minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  cancellationReason!: string;
}

export class FinalizeMatchDto {
  @ApiProperty({ type: String, example: "20:30", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" })
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  time!: string;

  @ApiProperty({ type: String, example: "BOX365" })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location!: string;

  @ApiPropertyOptional({ type: String, enum: venueTypes, nullable: true, example: "outdoor" })
  @IsOptional()
  @IsIn(venueTypes)
  venueType?: (typeof venueTypes)[number] | null;

  @ApiProperty({ type: Number, example: 120, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fieldPriceRubles!: number;
}

export class VoteCorrectionDto {
  @ApiPropertyOptional({ type: String, example: "42", pattern: "^[1-9]\\d*$" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  playerId?: string;

  @ApiPropertyOptional({ type: String, example: "987654321", pattern: "^[1-9]\\d*$" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  telegramUserId?: string;

  @ApiProperty({ type: String, enum: voteOptions, example: "going" })
  @IsIn(voteOptions)
  option!: (typeof voteOptions)[number];

  @ApiPropertyOptional({ type: String, nullable: true, example: "19:00" })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  availableAfter?: string | null;
}

export class ExternalParticipantCreateDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: "Команда Никиты", maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @ApiProperty({
    type: Number,
    example: 3,
    minimum: 1,
    maximum: MAX_EXTERNAL_PARTICIPANTS_PER_OPERATION,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_EXTERNAL_PARTICIPANTS_PER_OPERATION)
  quantity!: number;
}

export class ExternalParticipantUpdateDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: "Команда Никиты", maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;
}

function parseBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export class PlayerListQueryDto {
  @ApiPropertyOptional({ type: String, example: "Nikita" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseBoolean(value))
  @IsBoolean()
  confirmed?: boolean;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CreateAliasDto {
  @ApiProperty({ type: String, example: "@nikita_player" })
  @IsString()
  @Matches(USERNAME_PATTERN)
  username!: string;

  @ApiProperty({ type: String, example: "Никита" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @ApiPropertyOptional({ type: String, example: "42", pattern: "^[1-9]\\d*$" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  playerId?: string;
}

export class UpdateAliasDto {
  @ApiProperty({ type: String, example: "Никита С." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;
}

export class UpdatePlayerDto {
  @ApiProperty({ type: String, example: "Никита С." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;
}

export class RefreshMatchDto {
  @ApiPropertyOptional({ type: Boolean, default: true, description: "Reserved for forward-compatible refresh options." })
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

export class ReconcileMatchDto {
  @ApiProperty({ type: String, enum: ["attach", "retry"], example: "attach" })
  @IsIn(["attach", "retry"])
  action!: "attach" | "retry";

  @ApiPropertyOptional({ type: String, example: "1234", pattern: "^[1-9]\\d*$" })
  @ValidateIf((input: ReconcileMatchDto) => input.action === "attach")
  @IsString()
  @Matches(DECIMAL_ID_PATTERN)
  telegramMessageId?: string;
}
