import { describe, expect, test } from 'vitest'
import { isOrganizationOwnerClaimAvailable } from '../../src/organization/owner-claim-policy.js'

const now = new Date('2026-09-01T12:00:00Z')

describe('organization owner claim policy', () => {
  test.each([
    { owner: undefined, expected: true },
    {
      owner: {
        status: 'invalid' as const,
        freshUntil: new Date('2026-09-01T13:00:00Z'),
        graceUntil: null,
        invalidatedAt: null,
      },
      expected: true,
    },
    {
      owner: {
        status: 'degraded' as const,
        freshUntil: new Date('2026-09-01T11:00:00Z'),
        graceUntil: now,
        invalidatedAt: null,
      },
      expected: true,
    },
    {
      owner: {
        status: 'fresh' as const,
        freshUntil: new Date('2026-09-01T13:00:00Z'),
        graceUntil: null,
        invalidatedAt: null,
      },
      expected: false,
    },
  ])('returns $expected for $owner', ({ owner, expected }) => {
    expect(isOrganizationOwnerClaimAvailable(owner, now)).toBe(expected)
  })
})
