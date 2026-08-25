import { describe, expect, it } from 'vitest'

import { formatMatchDate, formatMatchTimeRange, formatVoteHistoryDateTime } from './date-format'

describe('formatMatchDate', () => {
  it('uses the weekday and long date without a year', () => {
    expect(formatMatchDate('2026-07-27', '19:30')).toBe('Понедельник, 27 июля · 19:30')
    expect(formatMatchDate('2026-07-28', '19:30')).toBe('Вторник, 28 июля · 19:30')
  })

  it('uses the same format outside the current week', () => {
    expect(formatMatchDate('2026-07-29', '19:30')).toBe('Среда, 29 июля · 19:30')
    expect(formatMatchDate('2026-08-03', '19:30')).toBe('Понедельник, 3 августа · 19:30')
  })

  it('does not add a separator when the time is absent', () => {
    expect(formatMatchDate('2026-08-03', '')).toBe('Понедельник, 3 августа')
  })

  it('adds the duration to the end of a match time range', () => {
    expect(formatMatchTimeRange('17:00', 90)).toBe('17:00-18:30')
    expect(formatMatchTimeRange('23:30', 90)).toBe('23:30-01:00')
  })
})

describe('formatVoteHistoryDateTime', () => {
  it('formats an event in the group time zone', () => {
    expect(formatVoteHistoryDateTime('2026-08-25T12:00:00.000Z', 'Europe/Minsk')).toBe('25 августа, 15:00')
  })
})
