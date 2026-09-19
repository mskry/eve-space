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
      sectionActivationVersion: 3,
    })
    const character = identity({
      kind: 'managed-organization-character',
      managedMemberLifecycleId: 'lifecycle-1',
      userId: 'user-1',
      characterId: 90_000_001,
      characterLifecycleId: 'character-lifecycle-1',
      authorizationGeneration: 4,
      disclosureVersion: 2,
      sectionActivationVersion: 3,
    })

    expect(platformReviewerContributionTargetResourceKey(account)).toEqual([
      'reviewer',
      'contributions',
      'overview',
      'targets',
      'lifecycle-1',
      'user-1',
      'section-activation',
      3,
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
      'section-activation',
      3,
      90_000_001,
      'character-lifecycle',
      'character-lifecycle-1',
      'authorization-generation',
      4,
      'disclosure-version',
      2,
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

  it('changes the private prefix for every live character authority identity', () => {
    const target = {
      kind: 'managed-organization-character' as const,
      managedMemberLifecycleId: 'lifecycle-1',
      userId: 'user-1',
      characterId: 90_000_001,
      characterLifecycleId: 'character-lifecycle-1',
      authorizationGeneration: 4,
      disclosureVersion: 2,
      sectionActivationVersion: 3,
    }
    const original = platformReviewerContributionTargetQueryKey(identity(target))

    for (const changed of [
      { ...target, characterLifecycleId: 'character-lifecycle-2' },
      { ...target, authorizationGeneration: 5 },
      { ...target, disclosureVersion: 3 },
      { ...target, sectionActivationVersion: 4 },
    ])
      expect(platformReviewerContributionTargetQueryKey(identity(changed))).not.toEqual(original)
  })
})

function accountTarget() {
  return {
    kind: 'managed-organization-account' as const,
    managedMemberLifecycleId: 'lifecycle-1',
    userId: 'user-1',
    sectionActivationVersion: 3,
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
        readonly characterLifecycleId: string
        readonly authorizationGeneration: number | null
        readonly disclosureVersion: number
        readonly sectionActivationVersion: number
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
