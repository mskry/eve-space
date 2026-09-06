import { describe, expect, test } from 'vitest'
import { resolveAffiliationFreshness } from '../../src/organization/affiliation-freshness.js'

const now = new Date('2026-09-01T12:00:00Z')

describe('organization affiliation freshness', () => {
  test.each([
    {
      character: {
        affiliationResolutionState: 'resolved' as const,
        affiliationCheckedAt: new Date('2026-09-01T11:00:00Z'),
        nextAffiliationCheck: new Date('2026-09-01T13:00:00Z'),
      },
      expected: 'fresh',
    },
    {
      character: {
        affiliationResolutionState: 'resolved' as const,
        affiliationCheckedAt: new Date('2026-09-01T11:00:00Z'),
        nextAffiliationCheck: new Date('2026-09-01T12:00:00Z'),
      },
      expected: 'stale',
    },
    {
      character: {
        affiliationResolutionState: 'pending' as const,
        affiliationCheckedAt: null,
        nextAffiliationCheck: null,
      },
      expected: 'unavailable',
    },
  ])('resolves $expected evidence', ({ character, expected }) => {
    expect(resolveAffiliationFreshness(character, now)).toBe(expected)
  })
})
