import { describe, expect, it } from 'vitest'
import {
  formatCharacterSecurityStatus,
  getCharacterSecurityStatusTone,
} from '../../app/utils/character-security-status'

describe('character security status', () => {
  it('formats security status to two decimal places without trailing zeroes', () => {
    expect(formatCharacterSecurityStatus(5.678)).toBe('+5.68')
    expect(formatCharacterSecurityStatus(-2.345)).toBe('-2.35')
    expect(formatCharacterSecurityStatus(0.001)).toBe('0.0')
  })

  it.each([
    [0, 'positive'],
    [1, 'positive'],
    [-0.1, 'warning'],
    [-5, 'danger'],
  ] as const)('maps %s to the %s tone', (value, tone) => {
    expect(getCharacterSecurityStatusTone(value)).toBe(tone)
  })
})
