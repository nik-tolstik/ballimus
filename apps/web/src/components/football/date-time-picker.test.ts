import { describe, expect, it } from 'vitest'

import { normalizeTimeInput } from './date-time-picker'

describe('normalizeTimeInput', () => {
  it('formats time in 24-hour notation while typing', () => {
    expect(normalizeTimeInput('18')).toBe('18')
    expect(normalizeTimeInput('180')).toBe('18:0')
    expect(normalizeTimeInput('18:00')).toBe('18:00')
  })
})
