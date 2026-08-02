import { describe, expect, it } from 'vitest'

import { formatMatchDate } from './date-format'

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
})
