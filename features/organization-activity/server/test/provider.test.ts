import { expect, test } from 'vitest'
import type { PlatformActivityProviderCharacter } from '@eve-space/platform-module-contract'
import { combineActivitySources } from '../src/provider-activities.js'
import { summarySnapshot } from '../src/snapshot.js'
import type { ActivitySourceRead } from '../src/activity-source.js'

const snapshot = {
  ...summarySnapshot(
    { id: 'a', name: 'Project', state: 'Active', progress: { current: 0, desired: 10 } },
    'project',
    9801,
  ),
  eligibility: 'unrestricted' as const,
  objective: 'manufacturing',
  reward: { initial: 1_000_000, remaining: 750_000 },
}
const status = {
  status: 'current' as const,
  validatedAt: '2026-09-07T10:00:00Z',
  authorizationGeneration: 1,
  lastFailureClass: null,
}
const source: ActivitySourceRead = {
  resourceId: 'corporation-projects',
  snapshots: [snapshot],
  status,
}
const character: PlatformActivityProviderCharacter = {
  characterId: 9001,
  name: 'Member',
  corporationId: 9801,
  allianceId: null,
  isMain: true,
  membership: 'managed',
  subjectLifecycleId: 'lifecycle',
  affiliationFreshness: 'fresh',
  affiliationCheckedAt: status.validatedAt,
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
          snapshots: [{ ...snapshot, contributed: 2, committed: true }],
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
            status: 'authorization-required',
            requiredScope: 'esi-corporations.read_projects.v1',
          },
        },
      ],
    },
  ])
  expect(result).toHaveLength(1)
  expect(result[0]?.eligibleCharacterIds).toEqual([9001])
  expect(result[0]).toMatchObject({
    objective: 'manufacturing',
    state: 'Active',
    progress: { current: 0, desired: 10 },
    reward: { initial: 1_000_000, remaining: 750_000 },
    linkTarget: { characterId: 9001 },
  })
  expect(result[0]?.participation).toEqual([
    { characterId: 9001, state: 'participating', contribution: 2 },
    { characterId: 9002, state: 'authorization-required', contribution: null },
  ])
  expect(result[0]?.requiredAction).toMatchObject({ kind: 'authorization', characterId: 9002 })
})

test('deduplicates public and private jobs with per-character participation', () => {
  const job = {
    ...summarySnapshot(
      { id: 'job-a', name: 'Freelance job', state: 'Active', progress: { current: 2, desired: 8 } },
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
            snapshots: [{ ...job, contributed: 3, committed: true }],
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
    id: 'job-a',
    kind: 'job',
    eligibleCharacterIds: [9001, 9002],
    participation: [
      { characterId: 9001, state: 'participating', contribution: 3 },
      { characterId: 9002, state: 'eligible', contribution: null },
    ],
  })
})

test('projects campaign participation without assigning an objective contribution', () => {
  const campaign = {
    ...snapshot,
    id: 'campaign-a',
    kind: 'campaign' as const,
    corporationId: null,
    title: 'Military campaign',
    objective: null,
    progress: { current: 0.4, desired: 1 },
    reward: null,
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
                id: 'objective-a',
                kind: 'objective' as const,
                campaignId: campaign.id,
                contributed: 0.25,
                committed: true,
              },
              {
                ...campaign,
                id: 'objective-b',
                kind: 'objective' as const,
                campaignId: campaign.id,
                contributed: 0.75,
                committed: true,
              },
            ],
          },
        ],
      },
    ],
  )

  expect(result[0]).toMatchObject({
    state: 'Active',
    progress: { current: 0.4, desired: 1 },
    participation: [{ characterId: 9001, state: 'participating', contribution: null }],
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
  ).toEqual([])
  expect(
    combineActivitySources(
      [source],
      [{ ...character, affiliationFreshness: 'stale' }],
      privateSources,
    )[0]?.eligibleCharacterIds,
  ).toEqual([])
})

test('omits completed records and projects outside the character corporation', () => {
  expect(
    combineActivitySources(
      [{ ...source, snapshots: [{ ...snapshot, state: 'Completed' }] }],
      [character],
      [],
    ),
  ).toEqual([])
  expect(
    combineActivitySources([source], [{ ...character, corporationId: 9802 }], [])[0]?.participation,
  ).toEqual([])
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
        if (subject.characterId) seen.add(subject.characterId)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active--
        return { ...status, subjectLifecycleId: undefined }
      },
    },
    persistence: {
      transaction: () => {
        throw new Error('No lifecycle should read storage')
      },
    },
  } as never)
  const characters = Array.from({ length: 30 }, (_, index) => ({
    ...character,
    characterId: 9001 + index,
  }))
  await provider({
    organizationVersion: 7,
    characters,
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
  expect(visited).toEqual([1])
  await expect(mapWithConcurrency([], 0, async (item) => item)).rejects.toThrow('concurrency')
})
