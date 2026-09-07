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
  expect(result[0]?.participation).toEqual([
    { characterId: 9001, state: 'participating' },
    { characterId: 9002, state: 'authorization-required' },
  ])
  expect(result[0]?.requiredAction).toMatchObject({ kind: 'authorization', characterId: 9002 })
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
