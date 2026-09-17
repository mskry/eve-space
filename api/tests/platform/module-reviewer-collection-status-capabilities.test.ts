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
  organizationVersion: 7,
  managedMemberLifecycleId,
  selection: { kind: 'account' },
  account: {
    userId,
    mainCharacter: { characterId, name: 'Target Main' },
  },
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
    state: 'compliant',
    evidenceFreshness: 'fresh',
    evidenceAt: '2026-09-16T11:55:00.000Z',
    reviewDeadline: null,
    accessValidUntil: '2026-09-16T13:00:00.000Z',
    evaluatedAt: '2026-09-16T11:55:00.000Z',
  },
  groups: [],
  block: { blocked: false },
} as const satisfies PlatformReviewerTargetContext
const resources = [
  {
    moduleId: 'member-audit',
    sectionId: 'skills',
    resourceId: 'trained-skills',
    subjectKind: 'character',
    operationId: 'skills',
    materializationIntervalSeconds: 900,
    eligibility: { kind: 'current-managed-member-character' },
    implementation: {},
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

    await expect(reads.read('trained-skills', characterId)).resolves.toEqual({
      status: 'current',
      moduleId: 'member-audit',
      sectionId: 'skills',
      resourceId: 'trained-skills',
      organizationVersion: 7,
      targetUserId: userId,
      managedMemberLifecycleId,
      characterId,
      characterLifecycleId,
      authorizationGeneration: 3,
      disclosureVersion: 1,
      validatedAt: '2026-09-16T11:55:00.000Z',
      lastFailureClass: null,
    })
    expect(resolveEligibility).toHaveBeenCalledWith(
      {
        moduleId: 'member-audit',
        resourceId: 'trained-skills',
        subjectKind: 'character',
        subjectLifecycleId: characterLifecycleId,
        subjectId: String(characterId),
      },
      { resources, now },
    )
  })

  test('returns authorization-required without exposing a target reauthorization path', async () => {
    const current = eligible(true)
    if (current.status !== 'eligible') throw new Error('Expected eligible test fixture')
    resolveEligibility.mockResolvedValue({
      authorizationGeneration: current.authorizationGeneration,
      managedAuthority: current.managedAuthority,
      nextEligibleAt: current.nextEligibleAt,
      status: 'authorization-required',
      dueReason: null,
      schedulingKey: null,
      requiredScope: 'esi-skills.read_skills.v1',
      validatedAt: null,
      lastFailureClass: null,
    } satisfies PlatformResourceEligibility)
    const reads = createReads()

    const status = await reads.read('trained-skills', characterId)

    expect(status).toEqual(
      expect.objectContaining({
        status: 'authorization-required',
        requiredScope: 'esi-skills.read_skills.v1',
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
    if (current.status !== 'eligible' || !current.managedAuthority)
      throw new Error('Expected managed eligibility fixture')
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
    if (current.status !== 'eligible') throw new Error('Expected eligible test fixture')
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
          selection: { kind: 'character', characterId, subjectLifecycleId: characterLifecycleId },
        },
      },
      { resources, now: () => now },
    )

    await expect(characterReads.read('missing', characterId)).rejects.toThrow(
      'Reviewer collection resource is unavailable',
    )
    await expect(characterReads.read('trained-skills', characterId + 1)).rejects.toThrow(
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
      status: 'stale',
      lastFailureClass: 'esi-unavailable',
      validatedAt: '2026-09-16T11:55:00.000Z',
    })
  })
})

function createReads() {
  return createPlatformReviewerCollectionStatusReads(
    { moduleId: 'member-audit', sectionId: 'skills', target },
    { resources, now: () => now, resolveEligibility },
  )
}

function eligible(due: boolean): PlatformResourceEligibility {
  return {
    status: 'eligible',
    due,
    dueReason: due ? 'elapsed' : 'future',
    schedulingKey: due
      ? new Date('2026-09-16T11:59:00.000Z')
      : new Date('2026-09-16T12:15:00.000Z'),
    authorizationGeneration: 3,
    nextEligibleAt: due
      ? new Date('2026-09-16T11:59:00.000Z')
      : new Date('2026-09-16T12:15:00.000Z'),
    validatedAt: new Date('2026-09-16T11:55:00.000Z'),
    lastFailureClass: null,
    managedAuthority: {
      organizationDeploymentId: 1,
      organizationVersion: 7,
      targetUserId: userId,
      managedMemberLifecycleId,
      sectionId: 'skills',
      disclosureVersion: 1,
      sectionActivationVersion: 1,
    },
  }
}
