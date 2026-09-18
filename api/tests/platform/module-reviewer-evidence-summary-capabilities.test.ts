import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type {
  PlatformReviewerCollectionStatus,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { expect, test, vi } from 'vitest'
import { createPlatformReviewerEvidenceSummaryReads } from '../../src/platform/module-reviewer-evidence-summary-capabilities.js'

const target = {
  organizationVersion: 7,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  selection: { kind: 'account' },
  account: {
    userId: '00000000-0000-4000-8000-000000000002',
    mainCharacter: { characterId: 90_000_001, name: 'Target Main' },
  },
  characters: [reviewerCharacter(90_000_001), reviewerCharacter(90_000_002)],
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
      resources,
      isContributionEnabled: vi.fn().mockResolvedValue(true),
      createStatusReads: () => ({ read }),
    },
  )

  await expect(summary.read()).resolves.toEqual([
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
          kind: 'character',
          characterId: 90_000_002,
          subjectLifecycleId: target.characters[1].subjectLifecycleId,
        },
      },
    },
    {
      resources,
      isContributionEnabled: vi.fn(async (_moduleId, sectionId) => sectionId === 'skills'),
      createStatusReads: () => ({ read }),
    },
  )

  const result = await summary.read()

  expect(result).toEqual([
    {
      characterId: 90_000_002,
      sections: [
        {
          sectionId: 'skills',
          resources: [
            {
              resourceId: 'trained-skills',
              status: 'current',
              validatedAt: '2026-09-16T12:00:00.000Z',
            },
          ],
        },
        {
          sectionId: 'wallet',
          resources: [
            { resourceId: 'wallet-balance', status: 'unavailable', validatedAt: null },
            { resourceId: 'wallet-journal', status: 'unavailable', validatedAt: null },
          ],
        },
      ],
    },
  ])
  expect(read).toHaveBeenCalledOnce()
})

function resource(sectionId: string, resourceId: string) {
  return {
    moduleId: 'member-audit',
    sectionId,
    resourceId,
    subjectKind: 'character',
    operationId: 'skills',
    materializationIntervalSeconds: 900,
    eligibility: { kind: 'current-managed-member-character' },
    implementation: {},
  } as PlatformInstalledResourceDescriptor
}

function reviewerCharacter(characterId: number) {
  return {
    characterId,
    subjectLifecycleId: `00000000-0000-4000-8000-${String(characterId).padStart(12, '0')}`,
    authorizationGeneration: 3,
    name: `Pilot ${characterId}`,
    isMain: characterId === 90_000_001,
    affiliation: {
      corporationId: 98_000_001,
      allianceId: null,
      membership: 'managed' as const,
      freshness: 'fresh' as const,
      checkedAt: '2026-09-16T11:55:00.000Z',
    },
  }
}

function status(resourceId: string, characterId: number): PlatformReviewerCollectionStatus {
  return {
    moduleId: 'member-audit',
    sectionId: resourceId === 'trained-skills' ? 'skills' : 'wallet',
    resourceId,
    organizationVersion: 7,
    targetUserId: target.account.userId,
    managedMemberLifecycleId: target.managedMemberLifecycleId,
    characterId,
    characterLifecycleId: target.characters.find(
      (character) => character.characterId === characterId,
    )!.subjectLifecycleId,
    authorizationGeneration: 3,
    disclosureVersion: 1,
    sectionActivationVersion: 1,
    status: 'current',
    validatedAt: '2026-09-16T12:00:00.000Z',
    lastFailureClass: null,
  }
}

function characterSummary(characterId: number) {
  return {
    characterId,
    sections: [
      {
        sectionId: 'skills',
        resources: [
          {
            resourceId: 'trained-skills',
            status: 'current',
            validatedAt: '2026-09-16T12:00:00.000Z',
          },
        ],
      },
      {
        sectionId: 'wallet',
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
      },
    ],
  }
}
