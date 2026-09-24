import { describe, expect, test } from 'vitest'
import { isOrganizationOwnerClaimAvailable } from '../../src/organization/owner-claim-policy.js'

const now = new Date('2026-09-01T12:00:00Z')

describe('organization owner claim policy', () => {
  test.each([
    { expected: true, owner: undefined },
    {
      expected: true,
      owner: {
        freshUntil: new Date('2026-09-01T13:00:00Z'),
        graceUntil: null,
        invalidatedAt: null,
        status: 'invalid' as const,
      },
    },
    {
      expected: true,
      owner: {
        freshUntil: new Date('2026-09-01T11:00:00Z'),
        graceUntil: now,
        invalidatedAt: null,
        status: 'degraded' as const,
      },
    },
    {
      expected: false,
      owner: {
        freshUntil: new Date('2026-09-01T13:00:00Z'),
        graceUntil: null,
        invalidatedAt: null,
        status: 'fresh' as const,
      },
    },
  ])('returns $expected for $owner', ({ owner, expected }) => {
    expect(isOrganizationOwnerClaimAvailable(owner, now)).toBe(expected)
  })
})
