import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type {
  PlatformReviewerCollectionStatus,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { expect, test, vi } from 'vitest'
import { createPlatformReviewerEvidenceSummaryReads } from '../../src/platform/module-reviewer-evidence-summary-capabilities.js'

const target = {
  account: {
    mainCharacter: { characterId: 90_000_001, name: 'Target Main' },
    userId: '00000000-0000-4000-8000-000000000002',
  },
  block: { blocked: false },
  characters: [reviewerCharacter(90_000_001), reviewerCharacter(90_000_002)],
  compliance: {
    accessValidUntil: '2026-09-16T13:00:00.000Z',
    evaluatedAt: '2026-09-16T11:55:00.000Z',
    evidenceAt: '2026-09-16T11:55:00.000Z',
    evidenceFreshness: 'fresh',
    reviewDeadline: null,
    state: 'compliant',
  },
  groups: [],
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  organizationVersion: 7,
  selection: { kind: 'account' },
} as const satisfies PlatformReviewerTargetContext

const resources = [
  resource('skills', 'trained-skills'),
  resource('wallet', 'wallet-balance'),
  resource('wallet', 'wallet-journal'),
]

test('projects only safe per-resource availability and freshness for bound characters', async () => {
  const read = vi.fn(async (resourceId: string, characterId: number) =>
    status(resourceId, characterId),
  )
  const summary = createPlatformReviewerEvidenceSummaryReads(
    { moduleId: 'member-audit', target },
    {
      createStatusReads: () => ({ read }),
      isContributionEnabled: vi.fn().mockResolvedValue(true),
      resources,
    },
  )

  await expect(summary.read()).resolves.toStrictEqual([
    characterSummary(90_000_001),
    characterSummary(90_000_002),
  ])
  expect(read).toHaveBeenCalledTimes(6)
})

test('reports disabled sections unavailable without reading collection authority', async () => {
  const read = vi.fn(async (resourceId: string, characterId: number) =>
    status(resourceId, characterId),
  )
  const summary = createPlatformReviewerEvidenceSummaryReads(
    {
      moduleId: 'member-audit',
      target: {
        ...target,
        selection: {
          characterId: 90_000_002,
          kind: 'character',
          subjectLifecycleId: target.characters[1].subjectLifecycleId,
        },
      },
    },
    {
      createStatusReads: () => ({ read }),
      isContributionEnabled: vi.fn(async (_moduleId, sectionId) => sectionId === 'skills'),
      resources,
    },
  )

  const result = await summary.read()

  expect(result).toStrictEqual([
    {
      characterId: 90_000_002,
      sections: [
        {
          resources: [
            {
              resourceId: 'trained-skills',
              status: 'current',
              validatedAt: '2026-09-16T12:00:00.000Z',
            },
          ],
          sectionId: 'skills',
        },
        {
          resources: [
            { resourceId: 'wallet-balance', status: 'unavailable', validatedAt: null },
            { resourceId: 'wallet-journal', status: 'unavailable', validatedAt: null },
          ],
          sectionId: 'wallet',
        },
      ],
    },
  ])
  expect(read).toHaveBeenCalledOnce()
})

test('limits contribution summaries to the exact declared section and resources', async () => {
  const read = vi.fn(async (resourceId: string, characterId: number) =>
    status(resourceId, characterId),
  )
  const summary = createPlatformReviewerEvidenceSummaryReads(
    {
      moduleId: 'member-audit',
      resourceIds: ['wallet-balance'],
      sectionId: 'wallet',
      target,
    },
    {
      createStatusReads: () => ({ read }),
      isContributionEnabled: vi.fn().mockResolvedValue(true),
      resources,
    },
  )

  const result = await summary.read()

  expect(result).toStrictEqual(
    target.characters.map(({ characterId }) => ({
      characterId,
      sections: [
        {
          resources: [
            {
              resourceId: 'wallet-balance',
              status: 'current',
              validatedAt: '2026-09-16T12:00:00.000Z',
            },
          ],
          sectionId: 'wallet',
        },
      ],
    })),
  )
  expect(read).toHaveBeenCalledTimes(2)
  expect(read).not.toHaveBeenCalledWith('wallet-journal', expect.any(Number))
})

test('uses an explicit workspace resource allowlist across evidence sections', async () => {
  const read = vi.fn(async (resourceId: string, characterId: number) =>
    status(resourceId, characterId),
  )
  const summary = createPlatformReviewerEvidenceSummaryReads(
    {
      moduleId: 'member-audit',
      resourceIds: ['trained-skills', 'wallet-balance', 'wallet-journal'],
      sectionId: 'overview',
      target,
    },
    {
      createStatusReads: () => ({ read }),
      isContributionEnabled: vi.fn().mockResolvedValue(true),
      resources,
    },
  )

  await expect(summary.read()).resolves.toStrictEqual([
    characterSummary(90_000_001),
    characterSummary(90_000_002),
  ])
  expect(read).toHaveBeenCalledTimes(6)
})

function resource(sectionId: string, resourceId: string) {
  return {
    eligibility: { kind: 'current-managed-member-character' },
    implementation: {},
    materializationIntervalSeconds: 900,
    moduleId: 'member-audit',
    operationId: 'skills',
    resourceId,
    sectionId,
    subjectKind: 'character',
  } as PlatformInstalledResourceDescriptor
}

function reviewerCharacter(characterId: number) {
  return {
    affiliation: {
      allianceId: null,
      checkedAt: '2026-09-16T11:55:00.000Z',
      corporationId: 98_000_001,
      freshness: 'fresh' as const,
      membership: 'managed' as const,
    },
    authorizationGeneration: 3,
    characterId,
    isMain: characterId === 90_000_001,
    name: `Pilot ${characterId}`,
    subjectLifecycleId: `00000000-0000-4000-8000-${String(characterId).padStart(12, '0')}`,
  }
}

function status(resourceId: string, characterId: number): PlatformReviewerCollectionStatus {
  return {
    authorizationGeneration: 3,
    characterId,
    characterLifecycleId: target.characters.find(
      (character) => character.characterId === characterId,
    )!.subjectLifecycleId,
    disclosureVersion: 1,
    lastFailureClass: null,
    managedMemberLifecycleId: target.managedMemberLifecycleId,
    moduleId: 'member-audit',
    organizationVersion: 7,
    resourceId,
    sectionActivationVersion: 1,
    sectionId: resourceId === 'trained-skills' ? 'skills' : 'wallet',
    status: 'current',
    targetUserId: target.account.userId,
    validatedAt: '2026-09-16T12:00:00.000Z',
  }
}

function characterSummary(characterId: number) {
  return {
    characterId,
    sections: [
      {
        resources: [
          {
            resourceId: 'trained-skills',
            status: 'current',
            validatedAt: '2026-09-16T12:00:00.000Z',
          },
        ],
        sectionId: 'skills',
      },
      {
        resources: [
          {
            resourceId: 'wallet-balance',
            status: 'current',
            validatedAt: '2026-09-16T12:00:00.000Z',
          },
          {
            resourceId: 'wallet-journal',
            status: 'current',
            validatedAt: '2026-09-16T12:00:00.000Z',
          },
        ],
        sectionId: 'wallet',
      },
    ],
  }
}
