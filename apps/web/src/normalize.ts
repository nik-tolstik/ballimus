import type { MatchResponseDto, VenueResponseDto } from '@football/api-client'

import { formatMatchDate } from './lib/date-format'

export interface NormalizedVenue {
  readonly id: string
  readonly name: string
  readonly mapUrl: string
  readonly venueType: 'outdoor' | 'indoor'
  readonly bookingContacts: readonly { readonly name?: string; readonly phone: string }[]
  readonly websiteUrl: string | undefined
  readonly archivedAt: string | undefined
  readonly version: number
}

export interface NormalizedMatch {
  readonly id: string
  readonly date: string
  readonly time: string
  readonly dateLabel: string
  readonly durationMinutes: number
  readonly venue: NormalizedVenue
  readonly fieldPriceByn: number | undefined
  readonly version: number
  readonly publicCardState: MatchResponseDto['publicCard']['publicationState']
}

export function normalizeVenue(venue: VenueResponseDto): NormalizedVenue {
  return {
    id: venue.id,
    name: venue.name,
    mapUrl: venue.mapUrl,
    venueType: venue.venueType,
    bookingContacts: venue.bookingContacts.map((contact) => ({
      ...(contact.name === undefined ? {} : { name: contact.name }),
      phone: contact.phone,
    })),
    websiteUrl: venue.websiteUrl ?? undefined,
    archivedAt: venue.archivedAt ?? undefined,
    version: venue.version,
  }
}

export function normalizeMatch(match: MatchResponseDto): NormalizedMatch {
  return {
    id: match.id,
    date: match.schedule.date,
    time: match.schedule.time,
    dateLabel: formatMatchDate(match.schedule.date, match.schedule.time),
    durationMinutes: match.durationMinutes ?? 90,
    venue: normalizeVenue(match.venue),
    fieldPriceByn: match.fieldPriceRubles ?? undefined,
    version: match.version,
    publicCardState: match.publicCard.publicationState,
  }
}
