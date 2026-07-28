import { z } from "zod";

/** The name used by OpenRouter for the structured response format. */
export const MATCH_DRAFT_SCHEMA_NAME = "match_draft";

export const DEFAULT_REQUIRED_PLAYERS = 10;
export const MIN_REQUIRED_PLAYERS = 1;
export const MAX_REQUIRED_PLAYERS = 100;
export const MIN_LOCATION_LENGTH = 2;
export const MAX_LOCATION_LENGTH = 200;
export const MATCH_VENUE_TYPES = ["outdoor", "indoor"] as const;
export type MatchVenueType = (typeof MATCH_VENUE_TYPES)[number];

export const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
export const LOCAL_TIME_PATTERN = "^(?:[01]\\d|2[0-3]):[0-5]\\d$";

/**
 * The JSON Schema sent to OpenRouter.
 *
 * All properties are required for strict structured output. Nullable values
 * represent input that is missing or ambiguous and remains to be clarified later.
 */
export const matchDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Match date normalized to YYYY-MM-DD in the configured timezone, or null.",
    },
    time: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Local match time normalized to HH:mm, or null.",
    },
    location: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "The match location with surrounding whitespace removed, or null.",
    },
    requiredPlayers: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description: "Required player count, or null when no count was supplied.",
    },
    venueType: {
      anyOf: [
        { type: "string", enum: MATCH_VENUE_TYPES },
        { type: "null" },
      ],
      description: "Whether the match is outdoors or indoors, or null when no format was supplied.",
    },
  },
  required: ["date", "time", "location", "requiredPlayers", "venueType"],
} as const;

/** The exact shape accepted from the model before deterministic normalization. */
export const matchDraftSchema = z
  .object({
    date: z.string().nullable(),
    time: z.string().nullable(),
    location: z.string().nullable(),
    requiredPlayers: z.number().int().nullable(),
    venueType: z.enum(MATCH_VENUE_TYPES).nullable().optional(),
  })
  .strict();

export type MatchDraftModelResponse = z.infer<typeof matchDraftSchema>;

/** The fully normalized and post-validated draft passed to match creation. */
export const normalizedMatchDraftSchema = z
  .object({
    date: z.string().regex(new RegExp(ISO_DATE_PATTERN)),
    time: z.string().regex(new RegExp(LOCAL_TIME_PATTERN)).nullable(),
    location: z.string().min(MIN_LOCATION_LENGTH).max(MAX_LOCATION_LENGTH).nullable(),
    fieldPriceRubles: z.number().int().nonnegative().optional(),
    dateLabel: z.string().min(1).max(100).optional(),
    timeLabel: z.string().min(1).max(100).optional(),
    venueType: z.enum(MATCH_VENUE_TYPES).nullable().optional(),
    requiredPlayers: z
      .number()
      .int()
      .min(MIN_REQUIRED_PLAYERS)
      .max(MAX_REQUIRED_PLAYERS),
  })
  .strict();

export type MatchDraft = z.infer<typeof normalizedMatchDraftSchema>;
