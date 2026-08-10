import { describe, expect, it } from 'vitest'

import { validateEditorValues } from './components/football/match-editor'
import { validatePollEditorValues } from './components/football/poll-editor'
import { normalizeMatch } from './normalize'

describe('information-card Mini App', () => {
  it('requires an exact time and a catalog venue when creating a card', () => {
    expect(validateEditorValues({ date: '2026-08-10', time: '20:00', durationMinutes: '90', venueId: '7', fieldPriceByn: '25' })).toBeUndefined()
    expect(validateEditorValues({ date: '2026-08-10', time: '20:00', durationMinutes: '90', venueId: '', fieldPriceByn: '' })).toBe('Выберите площадку из каталога.')
    expect(validateEditorValues({ date: '2026-08-10', time: '20:00', durationMinutes: '10', venueId: '7', fieldPriceByn: '' })).toBe('Длительность матча должна быть от 15 до 480 минут.')
  })

  it('normalizes a card without roster, players, or vote fields', () => {
    const match = normalizeMatch({
      id: '42', chatId: '-1001', scheduledAt: '2026-08-10T17:00:00.000Z',
      schedule: { date: '2026-08-10', time: '20:00', timezone: 'Europe/Minsk' }, durationMinutes: 90,
      venue: { id: '7', name: 'Тестовая площадка', mapUrl: 'https://maps.example.test/7', venueType: 'indoor', bookingContacts: [], websiteUrl: null, archivedAt: null, version: 1, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z' },
      fieldPriceRubles: 25, version: 1, creatorTelegramUserId: '11', deletionRequestedAt: null, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
      publicCard: { publicationState: 'published', telegramMessageId: '99', publicationAttemptedAt: '2026-08-01T10:00:00.000Z', lastError: null },
    })

    expect(match).toMatchObject({ id: '42', date: '2026-08-10', time: '20:00', durationMinutes: 90, fieldPriceByn: 25, publicCardState: 'published' })
    expect('roster' in match).toBe(false)
  })

  it('requires valid native poll options and defaults notifications to disabled', () => {
    const valid = {
      question: 'Кто играет?',
      options: [
        { key: '1', text: 'Буду', notificationThreshold: '10' },
        { key: '2', text: 'Не буду', notificationThreshold: null },
      ],
      isAnonymous: true,
      allowsMultipleAnswers: false,
    }
    expect(validatePollEditorValues(valid)).toBeUndefined()
    expect(validatePollEditorValues({ ...valid, options: [valid.options[0]!] })).toBe('Добавьте от 2 до 12 вариантов ответа.')
    expect(validatePollEditorValues({ ...valid, options: [{ ...valid.options[0]!, notificationThreshold: '0' }, valid.options[1]!] })).toBe('Порог оповещения должен быть целым числом от 1 до 1 000 000.')
  })
})
