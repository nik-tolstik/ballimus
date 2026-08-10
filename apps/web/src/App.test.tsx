import { describe, expect, it } from 'vitest'

import { validateEditorValues } from './components/football/match-editor'
import { normalizeMatch } from './normalize'

describe('information-card Mini App', () => {
  it('requires an exact time and a catalog venue when creating a card', () => {
    expect(validateEditorValues({ date: '2026-08-10', time: '20:00', venueId: '7', fieldPriceByn: '25' })).toBeUndefined()
    expect(validateEditorValues({ date: '2026-08-10', time: '20:00', venueId: '', fieldPriceByn: '' })).toBe('Выберите площадку из каталога.')
  })

  it('normalizes a card without roster, players, or vote fields', () => {
    const match = normalizeMatch({
      id: '42', chatId: '-1001', scheduledAt: '2026-08-10T17:00:00.000Z',
      schedule: { date: '2026-08-10', time: '20:00', timezone: 'Europe/Minsk' },
      venue: { id: '7', name: 'Тестовая площадка', mapUrl: 'https://maps.example.test/7', venueType: 'indoor', bookingContacts: [], websiteUrl: null, archivedAt: null, version: 1, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z' },
      fieldPriceRubles: 25, version: 1, creatorTelegramUserId: '11', deletionRequestedAt: null, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
      publicCard: { publicationState: 'published', telegramMessageId: '99', publicationAttemptedAt: '2026-08-01T10:00:00.000Z', lastError: null },
    })

    expect(match).toMatchObject({ id: '42', date: '2026-08-10', time: '20:00', fieldPriceByn: 25, publicCardState: 'published' })
    expect('roster' in match).toBe(false)
  })
})
