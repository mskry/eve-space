import { describe, expect, it, vi } from 'vitest'
import {
  platformReviewerContributionTargetQueryKey,
  platformReviewerContributionTargetResourceKey,
} from '../src/runtime/query-keys.js'
import { removePlatformReviewerContributionTargetQueries } from '../src/runtime/query-lifecycle.js'

describe('reviewer contribution target query lifecycle', () => {
  it('keys account and character targets by current organization and managed lifecycle', () => {
    const account = identity({
      kind: 'managed-organization-account',
      managedMemberLifecycleId: 'lifecycle-1',
      userId: 'user-1',
    })
    const character = identity({
      kind: 'managed-organization-character',
      managedMemberLifecycleId: 'lifecycle-1',
      userId: 'user-1',
      characterId: 90_000_001,
    })

    expect(platformReviewerContributionTargetResourceKey(account)).toEqual([
      'reviewer',
      'contributions',
      'overview',
      'targets',
      'lifecycle-1',
      'user-1',
    ])
    expect(platformReviewerContributionTargetQueryKey(character)).toEqual([
      'private',
      'organization',
      7,
      'modules',
      'alpha',
      'sections',
      'review',
      'reviewer',
      'contributions',
      'overview',
      'targets',
      'lifecycle-1',
      'user-1',
      90_000_001,
    ])
  })

  it('cancels and removes only the exact contribution target prefix', () => {
    const matching = {
      key: [...platformReviewerContributionTargetQueryKey(identity(accountTarget())), 'summary'],
    }
    const unrelated = { key: ['private', 'organization', 7, 'modules', 'beta'] }
    const queryCache = {
      cancelQueries: vi.fn(),
      getEntries: vi.fn().mockReturnValue([matching]),
      remove: vi.fn(),
    }

    removePlatformReviewerContributionTargetQueries(queryCache as never, identity(accountTarget()))

    expect(queryCache.cancelQueries).toHaveBeenCalledWith(
      { key: platformReviewerContributionTargetQueryKey(identity(accountTarget())) },
      expect.any(Error),
    )
    expect(queryCache.remove).toHaveBeenCalledWith(matching)
    expect(queryCache.remove).not.toHaveBeenCalledWith(unrelated)
  })
})

function accountTarget() {
  return {
    kind: 'managed-organization-account' as const,
    managedMemberLifecycleId: 'lifecycle-1',
    userId: 'user-1',
  }
}

function identity(
  target:
    | ReturnType<typeof accountTarget>
    | {
        readonly kind: 'managed-organization-character'
        readonly managedMemberLifecycleId: string
        readonly userId: string
        readonly characterId: number
      },
) {
  return {
    organizationVersion: 7,
    moduleId: 'alpha',
    sectionId: 'review',
    contributionId: 'overview',
    target,
  }
}
