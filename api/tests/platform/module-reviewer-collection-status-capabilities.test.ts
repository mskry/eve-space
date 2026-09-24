import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type { PlatformReviewerTargetContext } from '@eve-space/platform-module-contract/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createPlatformReviewerCollectionStatusReads } from '../../src/platform/module-reviewer-collection-status-capabilities.js'
import type { PlatformResourceEligibility } from '../../src/platform/resource-eligibility.js'

const userId = '00000000-0000-4000-8000-000000000002'
const managedMemberLifecycleId = '00000000-0000-4000-8000-000000000020'
const characterLifecycleId = '00000000-0000-4000-8000-000000000021'
const characterId = 90_000_001
const now = new Date('2026-09-16T12:00:00.000Z')
const target = {
  account: {
    mainCharacter: { characterId, name: 'Target Main' },
    userId,
  },
  block: { blocked: false },
  characters: [
    {
      characterId,
      subjectLifecycleId: characterLifecycleId,
      authorizationGeneration: 3,
      name: 'Target Main',
      isMain: true,
      affiliation: {
        corporationId: 98_000_001,
        allianceId: null,
        membership: 'managed',
        freshness: 'fresh',
        checkedAt: '2026-09-16T11:55:00.000Z',
      },
    },
  ],
  compliance: {
    accessValidUntil: '2026-09-16T13:00:00.000Z',
    evaluatedAt: '2026-09-16T11:55:00.000Z',
    evidenceAt: '2026-09-16T11:55:00.000Z',
    evidenceFreshness: 'fresh',
    reviewDeadline: null,
    state: 'compliant',
  },
  groups: [],
  managedMemberLifecycleId,
  organizationVersion: 7,
  selection: { kind: 'account' },
} as const satisfies PlatformReviewerTargetContext
const resources = [
  {
    eligibility: { kind: 'current-managed-member-character' },
    implementation: {},
    materializationIntervalSeconds: 900,
    moduleId: 'member-audit',
    operationId: 'skills',
    resourceId: 'trained-skills',
    sectionId: 'skills',
    subjectKind: 'character',
  } as PlatformInstalledResourceDescriptor,
]
const resolveEligibility = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('platform reviewer collection-status capabilities', () => {
  test('reports only collection state bound to the current reviewer target authority', async () => {
    resolveEligibility.mockResolvedValue(eligible(false))
    const reads = createReads()

    await expect(reads.read('trained-skills', characterId)).resolves.toStrictEqual({
      authorizationGeneration: 3,
      characterId,
      characterLifecycleId,
      disclosureVersion: 1,
      lastFailureClass: null,
      managedMemberLifecycleId,
      moduleId: 'member-audit',
      organizationVersion: 7,
      resourceId: 'trained-skills',
      sectionActivationVersion: 1,
      sectionId: 'skills',
      status: 'current',
      targetUserId: userId,
      validatedAt: '2026-09-16T11:55:00.000Z',
    })
    expect(resolveEligibility).toHaveBeenCalledWith(
      {
        moduleId: 'member-audit',
        resourceId: 'trained-skills',
        subjectId: String(characterId),
        subjectKind: 'character',
        subjectLifecycleId: characterLifecycleId,
      },
      { now, resources },
    )
  })

  test('returns authorization-required without exposing a target reauthorization path', async () => {
    const current = eligible(true)
    if (current.status !== 'eligible') {
      throw new Error('Expected eligible test fixture')
    }
    resolveEligibility.mockResolvedValue({
      authorizationGeneration: current.authorizationGeneration,
      dueReason: null,
      lastFailureClass: null,
      managedAuthority: current.managedAuthority,
      nextEligibleAt: current.nextEligibleAt,
      requiredScope: 'esi-skills.read_skills.v1',
      schedulingKey: null,
      status: 'authorization-required',
      validatedAt: null,
    } satisfies PlatformResourceEligibility)
    const reads = createReads()

    const status = await reads.read('trained-skills', characterId)

    expect(status).toStrictEqual(
      expect.objectContaining({
        requiredScope: 'esi-skills.read_skills.v1',
        status: 'authorization-required',
        validatedAt: null,
      }),
    )
    expect(status).not.toHaveProperty('reauthorizationPath')
    expect(resolveEligibility).toHaveBeenCalledOnce()
  })

  test('refuses a target whose managed authority is no longer current', async () => {
    resolveEligibility.mockResolvedValue({ status: 'obsolete' })
    const reads = createReads()

    await expect(reads.read('trained-skills', characterId)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
  })

  test.each([
    ['organization version', { organizationVersion: 8 }],
    ['target account', { targetUserId: '00000000-0000-4000-8000-000000000099' }],
    [
      'managed-member lifecycle',
      { managedMemberLifecycleId: '00000000-0000-4000-8000-000000000099' },
    ],
    ['section', { sectionId: 'assets' }],
  ])('refuses a mismatched %s authority binding', async (_label, authorityOverride) => {
    const current = eligible(false)
    if (current.status !== 'eligible' || !current.managedAuthority) {
      throw new Error('Expected managed eligibility fixture')
    }
    resolveEligibility.mockResolvedValue({
      ...current,
      managedAuthority: { ...current.managedAuthority, ...authorityOverride },
    })

    await expect(createReads().read('trained-skills', characterId)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
  })

  test('refuses a target context from an older authorization generation', async () => {
    const current = eligible(false)
    if (current.status !== 'eligible') {
      throw new Error('Expected eligible test fixture')
    }
    resolveEligibility.mockResolvedValue({ ...current, authorizationGeneration: 4 })

    await expect(createReads().read('trained-skills', characterId)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
  })

  test('refuses undeclared resources and characters outside the selected target before storage', async () => {
    const characterReads = createPlatformReviewerCollectionStatusReads(
      {
        moduleId: 'member-audit',
        sectionId: 'skills',
        target: {
          ...target,
          selection: { characterId, kind: 'character', subjectLifecycleId: characterLifecycleId },
        },
      },
      { now: () => now, resources },
    )

    await expect(characterReads.read('missing', characterId)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
    await expect(characterReads.read('trained-skills', characterId + 1)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
    expect(resolveEligibility).not.toHaveBeenCalled()
  })

  test('refuses another resource in the same module section when the contribution did not declare it', async () => {
    const reads = createPlatformReviewerCollectionStatusReads(
      {
        moduleId: 'member-audit',
        resourceIds: ['trained-skills'],
        sectionId: 'skills',
        target,
      },
      {
        now: () => now,
        resolveEligibility,
        resources: [
          ...resources,
          {
            ...resources[0]!,
            resourceId: 'private-skill-history',
          } as PlatformInstalledResourceDescriptor,
          {
            ...resources[0]!,
            moduleId: 'other-module',
            resourceId: 'other-private-data',
          } as PlatformInstalledResourceDescriptor,
        ],
      },
    )

    await expect(reads.read('private-skill-history', characterId)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
    await expect(reads.read('other-private-data', characterId)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
    expect(resolveEligibility).not.toHaveBeenCalled()
  })

  test('preserves sanitized stale failure state for the exact authority binding', async () => {
    resolveEligibility.mockResolvedValue({
      ...eligible(true),
      lastFailureClass: 'esi-unavailable',
    })

    await expect(createReads().read('trained-skills', characterId)).resolves.toMatchObject({
      lastFailureClass: 'esi-unavailable',
      status: 'stale',
      validatedAt: '2026-09-16T11:55:00.000Z',
    })
  })
})

function createReads() {
  return createPlatformReviewerCollectionStatusReads(
    { moduleId: 'member-audit', sectionId: 'skills', target },
    { now: () => now, resolveEligibility, resources },
  )
}

function eligible(due: boolean): PlatformResourceEligibility {
  return {
    authorizationGeneration: 3,
    due,
    dueReason: due ? 'elapsed' : 'future',
    lastFailureClass: null,
    managedAuthority: {
      disclosureVersion: 1,
      managedMemberLifecycleId,
      organizationDeploymentId: 1,
      organizationVersion: 7,
      sectionActivationVersion: 1,
      sectionId: 'skills',
      targetUserId: userId,
    },
    nextEligibleAt: due
      ? new Date('2026-09-16T11:59:00.000Z')
      : new Date('2026-09-16T12:15:00.000Z'),
    schedulingKey: due
      ? new Date('2026-09-16T11:59:00.000Z')
      : new Date('2026-09-16T12:15:00.000Z'),
    status: 'eligible',
    validatedAt: new Date('2026-09-16T11:55:00.000Z'),
  }
}
