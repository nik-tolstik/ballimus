import { describe, expect, it } from 'vitest'

import { formatMatchDate } from './date-format'

const monday = new Date(2026, 6, 27, 10)

describe('formatMatchDate', () => {
  it('shows today and tomorrow explicitly', () => {
    expect(formatMatchDate('2026-07-27', '19:30', monday)).toBe('Сегодня · 19:30')
    expect(formatMatchDate('2026-07-28', '19:30', monday)).toBe('Завтра · 19:30')
  })

  it('uses the weekday for a later date in the current week', () => {
    expect(formatMatchDate('2026-07-29', '19:30', monday)).toBe('Среда · 19:30')
  })

  it('uses a full date from the next Monday onwards', () => {
    expect(formatMatchDate('2026-08-03', '19:30', monday)).toBe('3 августа · 19:30')
  })
})
