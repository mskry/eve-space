import { describe, expect, test } from 'vitest'
import { isOrganizationOwnerClaimAvailable } from '../../src/organization/owner-claim-policy.js'

const now = new Date('2026-09-01T12:00:00Z')

describe('organization owner claim policy', () => {
  test.each([
    { owner: undefined, expected: true },
    {
      owner: { failureClass: 'strict:not-director', reviewDeadline: null },
      expected: true,
    },
    {
      owner: { failureClass: 'grace:esi-unavailable', reviewDeadline: now },
      expected: true,
    },
    {
      owner: {
        failureClass: null,
        reviewDeadline: new Date('2026-09-01T13:00:00Z'),
      },
      expected: false,
    },
  ])('returns $expected for $owner', ({ owner, expected }) => {
    expect(isOrganizationOwnerClaimAvailable(owner, now)).toBe(expected)
  })
})
