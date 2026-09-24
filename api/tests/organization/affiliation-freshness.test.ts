import { describe, expect, test } from 'vitest'
import { resolveAffiliationFreshness } from '../../src/organization/affiliation-freshness.js'

const now = new Date('2026-09-01T12:00:00Z')

describe('organization affiliation freshness', () => {
  test.each([
    {
      character: {
        affiliationCheckedAt: new Date('2026-09-01T11:00:00Z'),
        affiliationResolutionState: 'resolved' as const,
        nextAffiliationCheck: new Date('2026-09-01T13:00:00Z'),
      },
      expected: 'fresh',
    },
    {
      character: {
        affiliationCheckedAt: new Date('2026-09-01T11:00:00Z'),
        affiliationResolutionState: 'resolved' as const,
        nextAffiliationCheck: new Date('2026-09-01T12:00:00Z'),
      },
      expected: 'stale',
    },
    {
      character: {
        affiliationCheckedAt: null,
        affiliationResolutionState: 'pending' as const,
        nextAffiliationCheck: null,
      },
      expected: 'unavailable',
    },
  ])('resolves $expected evidence', ({ character, expected }) => {
    expect(resolveAffiliationFreshness(character, now)).toBe(expected)
  })
})
