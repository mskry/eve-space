import { expect, test } from 'vitest'
import type { PlatformActivityProviderCharacter } from '@eve-space/platform-module-contract/activity'
import { combineActivitySources } from '../src/provider-activities.js'
import { summarySnapshot } from '../src/snapshot.js'
import type { ActivitySourceRead } from '../src/activity-source.js'

const snapshot = {
  ...summarySnapshot(
    { id: 'a', name: 'Project', progress: { current: 0, desired: 10 }, state: 'Active' },
    'project',
    9801,
  ),
  eligibility: 'unrestricted' as const,
  objective: 'manufacturing',
  reward: { initial: 1_000_000, remaining: 750_000 },
}
const status = {
  authorizationGeneration: 1,
  lastFailureClass: null,
  status: 'current' as const,
  validatedAt: '2026-09-07T10:00:00Z',
}
const source: ActivitySourceRead = {
  resourceId: 'corporation-projects',
  snapshots: [snapshot],
  status,
}
const character: PlatformActivityProviderCharacter = {
  affiliationCheckedAt: status.validatedAt,
  affiliationFreshness: 'fresh',
  allianceId: null,
  characterId: 9001,
  corporationId: 9801,
  isMain: true,
  membership: 'managed',
  name: 'Member',
  subjectLifecycleId: 'lifecycle',
}

test('deduplicates activities and keeps character scopes independent, excluding external characters', () => {
  const chars = [
    character,
    { ...character, characterId: 9002 },
    { ...character, characterId: 9003, membership: 'approved-external' as const },
  ]
  const result = combineActivitySources([source, source], chars, [
    {
      characterId: 9001,
      sources: [
        {
          ...source,
          resourceId: 'character-projects',
          snapshots: [{ ...snapshot, committed: true, contributed: 2 }],
        },
      ],
    },
    {
      characterId: 9002,
      sources: [
        {
          ...source,
          resourceId: 'character-projects',
          status: {
            ...status,
            requiredScope: 'esi-corporations.read_projects.v1',
            status: 'authorization-required',
          },
        },
      ],
    },
  ])
  expect(result).toHaveLength(1)
  expect(result[0]?.eligibleCharacterIds).toStrictEqual([9001])
  expect(result[0]).toMatchObject({
    linkTarget: { characterId: 9001 },
    objective: 'manufacturing',
    progress: { current: 0, desired: 10 },
    reward: { initial: 1_000_000, remaining: 750_000 },
    state: 'Active',
  })
  expect(result[0]?.participation).toStrictEqual([
    { characterId: 9001, contribution: 2, state: 'participating' },
    { characterId: 9002, contribution: null, state: 'authorization-required' },
  ])
  expect(result[0]?.requiredAction).toMatchObject({ characterId: 9002, kind: 'authorization' })
})

test('deduplicates public and private jobs with per-character participation', () => {
  const job = {
    ...summarySnapshot(
      { id: 'job-a', name: 'Freelance job', progress: { current: 2, desired: 8 }, state: 'Active' },
      'job',
      null,
    ),
    eligibility: 'unrestricted' as const,
  }
  const publicJobs = { ...source, resourceId: 'public-jobs', snapshots: [job] }
  const result = combineActivitySources(
    [publicJobs],
    [character, { ...character, characterId: 9002 }],
    [
      {
        characterId: 9001,
        sources: [
          {
            ...source,
            resourceId: 'character-jobs',
            snapshots: [{ ...job, committed: true, contributed: 3 }],
          },
        ],
      },
      {
        characterId: 9002,
        sources: [{ ...source, resourceId: 'character-jobs', snapshots: [] }],
      },
    ],
  )

  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({
    eligibleCharacterIds: [9001, 9002],
    id: 'job-a',
    kind: 'job',
    participation: [
      { characterId: 9001, state: 'participating', contribution: 3 },
      { characterId: 9002, state: 'eligible', contribution: null },
    ],
  })
})

test('projects campaign participation without assigning an objective contribution', () => {
  const campaign = {
    ...snapshot,
    corporationId: null,
    id: 'campaign-a',
    kind: 'campaign' as const,
    objective: null,
    progress: { current: 0.4, desired: 1 },
    reward: null,
    title: 'Military campaign',
  }
  const result = combineActivitySources(
    [{ ...source, resourceId: 'campaigns', snapshots: [campaign] }],
    [character],
    [
      {
        characterId: 9001,
        sources: [
          {
            ...source,
            resourceId: 'character-campaigns',
            snapshots: [
              {
                ...campaign,
                campaignId: campaign.id,
                committed: true,
                contributed: 0.25,
                id: 'objective-a',
                kind: 'objective' as const,
              },
              {
                ...campaign,
                campaignId: campaign.id,
                committed: true,
                contributed: 0.75,
                id: 'objective-b',
                kind: 'objective' as const,
              },
            ],
          },
        ],
      },
    ],
  )

  expect(result[0]).toMatchObject({
    participation: [{ characterId: 9001, state: 'participating', contribution: null }],
    progress: { current: 0.4, desired: 1 },
    state: 'Active',
  })
})

test('stale sources and stale affiliation never grant eligibility', () => {
  const privateSources = [
    { characterId: 9001, sources: [{ ...source, resourceId: 'character-projects' }] },
  ]
  expect(
    combineActivitySources(
      [{ ...source, status: { ...status, status: 'stale' } }],
      [character],
      privateSources,
    )[0]?.eligibleCharacterIds,
  ).toStrictEqual([])
  expect(
    combineActivitySources(
      [source],
      [{ ...character, affiliationFreshness: 'stale' }],
      privateSources,
    )[0]?.eligibleCharacterIds,
  ).toStrictEqual([])
})

test('omits completed records and projects outside the character corporation', () => {
  expect(
    combineActivitySources(
      [{ ...source, snapshots: [{ ...snapshot, state: 'Completed' }] }],
      [character],
      [],
    ),
  ).toStrictEqual([])
  expect(
    combineActivitySources([source], [{ ...character, corporationId: 9802 }], [])[0]?.participation,
  ).toStrictEqual([])
})

test('provider caps concurrent reads while retaining every managed character', async () => {
  const { organizationActivityProvider } = await import('../src/provider.js')
  let active = 0
  let maximum = 0
  const seen = new Set<number>()
  const provider = organizationActivityProvider({
    collectionStatus: {
      read: async (_id: string, subject: { characterId?: number }) => {
        active++
        maximum = Math.max(maximum, active)
        if (subject.characterId) {
          seen.add(subject.characterId)
        }
        await new Promise((resolve) => setTimeout(resolve, 1))
        active--
        return { ...status, subjectLifecycleId: undefined }
      },
    },
    persistence: {
      readActivitySnapshots: () => {
        throw new Error('No lifecycle should read storage')
      },
    },
  } as never)
  const characters = Array.from({ length: 30 }, (_, index) => ({
    ...character,
    characterId: 9001 + index,
  }))
  await provider({
    characters,
    organizationVersion: 7,
    signal: new AbortController().signal,
  } as never)
  expect(maximum).toBeLessThanOrEqual(4)
  expect(seen.size).toBe(30)
})

test('bounded readers stop scheduling after cancellation', async () => {
  const { mapWithConcurrency } = await import('../src/bounded-map.js')
  const controller = new AbortController()
  const visited: number[] = []
  await expect(
    mapWithConcurrency(
      [1, 2, 3],
      1,
      async (item) => {
        visited.push(item)
        controller.abort()
        return item
      },
      controller.signal,
    ),
  ).rejects.toThrow('aborted')
  expect(visited).toStrictEqual([1])
  await expect(mapWithConcurrency([], 0, async (item) => item)).rejects.toThrow('concurrency')
})
