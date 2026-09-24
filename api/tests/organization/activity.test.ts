import type {
  PlatformActivity,
  PlatformActivityProviderCharacter,
  PlatformInstalledActivityProviderDescriptor,
} from '@eve-space/platform-module-contract/activity'
import { describe, expect, test, vi } from 'vitest'
import { aggregateOrganizationActivities } from '../../src/organization/activity.js'

const now = new Date('2026-09-02T12:00:00.000Z')
const organization = {
  accessValidUntil: new Date('2026-09-02T13:00:00.000Z'),
  blocked: false,
  evidenceFreshness: 'fresh' as const,
  organizationVersion: 7,
  reviewDeadline: null,
  state: 'compliant' as const,
}
const characters: readonly PlatformActivityProviderCharacter[] = [
  {
    affiliationCheckedAt: '2026-09-02T11:55:00.000Z',
    affiliationFreshness: 'fresh',
    allianceId: null,
    characterId: 9001,
    corporationId: 98_000_001,
    isMain: true,
    membership: 'managed',
    name: 'Main',
    subjectLifecycleId: '6f466907-5fb2-4756-bd22-831f5a0293ba',
  },
]

describe('organization activity aggregation', () => {
  test('does not authorize or invoke disabled providers', async () => {
    const invoke = vi.fn()
    const authorize = vi.fn()
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize,
      loadCharacters: vi.fn(),
      loadEnabledModuleIds: async () => [],
      now,
      providers: [provider('alpha', invoke)],
    })

    expect(result.activities).toStrictEqual([])
    expect(result.sources).toStrictEqual([])
    expect(result.stale).toBe(false)
    expect(authorize).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  test('does not authorize a provider from a disabled section', async () => {
    const invoke = vi.fn()
    const authorize = vi.fn()

    await aggregateOrganizationActivities('user-1', organization, {
      authorize,
      loadCharacters: vi.fn(),
      loadEnabledModuleIds: async () => ['alpha'],
      loadEnabledSectionKeys: async () => new Set(['alpha/assets']),
      now,
      providers: [provider('alpha', invoke, 'skills')],
    })

    expect(authorize).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  test('never invokes unauthorized providers or loads private character context', async () => {
    const invoke = vi.fn()
    const loadCharacters = vi.fn()
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize: vi.fn().mockResolvedValue({ authorized: false, reason: 'permission' }),
      loadCharacters,
      loadEnabledModuleIds: async () => ['alpha'],
      now,
      providers: [provider('alpha', invoke)],
    })

    expect(result.activities).toStrictEqual([])
    expect(result.sources).toStrictEqual([])
    expect(loadCharacters).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  test('degrades authorized providers when bounded character context is unavailable', async () => {
    const invoke = vi.fn()
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize: authorized,
      loadCharacters: async () => {
        throw new Error('Organization version changed')
      },
      loadEnabledModuleIds: async () => ['alpha'],
      now,
      providers: [provider('alpha', invoke)],
    })

    expect(result.activities).toStrictEqual([])
    expect(result.sources[0]?.freshness.state).toBe('unavailable')
    expect(invoke).not.toHaveBeenCalled()
  })

  test('isolates provider failures and strictly projects member-safe fields', async () => {
    const successful = provider(
      'alpha',
      vi.fn().mockResolvedValue({
        activities: [{ ...activity('safe'), rawEsi: { directorIds: [42] }, accessToken: 'secret' }],
        freshness: freshness(),
      } as never),
    )
    const healthy = provider(
      'beta',
      vi.fn().mockResolvedValue({ activities: [activity('healthy')], freshness: freshness() }),
    )
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize: authorized,
      loadCharacters: async () => characters,
      loadEnabledModuleIds: async () => ['alpha', 'beta'],
      now,
      providers: [successful, healthy],
    })

    expect(result.activities.map(({ id }) => id)).toStrictEqual(['beta:activity:healthy'])
    expect(result.sources).toStrictEqual([
      expect.objectContaining({
        freshness: { collectedAt: null, state: 'unavailable' },
        sourceId: 'alpha:activity',
      }),
      expect.objectContaining({
        freshness: freshness(),
        sourceId: 'beta:activity',
      }),
    ])
    expect(JSON.stringify(result)).not.toMatch(/rawEsi|directorIds|accessToken|secret/)
  })

  test('merges compatible duplicates and sorts by action, priority, deadline, and ID', async () => {
    const duplicate = activity('duplicate', {
      eligibleCharacterIds: [],
      participation: [],
    })
    const invoke = vi.fn().mockResolvedValue({
      activities: [
        activity('offset-late', {
          requiredAction: { kind: 'delivery', label: 'Deliver', characterId: 9001 },
          organizationPriority: 30,
          deadline: '2026-09-02T23:00:00.000Z',
        }),
        activity('offset-early', {
          requiredAction: { kind: 'delivery', label: 'Deliver', characterId: 9001 },
          organizationPriority: 30,
          deadline: '2026-09-03T00:00:00.000+14:00',
        }),
        activity('passive-high', { organizationPriority: 100 }),
        activity('later', {
          requiredAction: { kind: 'delivery', label: 'Deliver', characterId: 9001 },
          organizationPriority: 20,
          deadline: '2026-09-04T12:00:00.000Z',
        }),
        activity('earlier', {
          requiredAction: { kind: 'acceptance', label: 'Accept', characterId: 9001 },
          organizationPriority: 20,
          deadline: '2026-09-03T12:00:00.000Z',
        }),
        duplicate,
        activity('duplicate', {
          eligibleCharacterIds: [9001],
          participation: [{ characterId: 9001, state: 'eligible', contribution: null }],
        }),
      ],
      freshness: freshness(),
    })
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize: authorized,
      loadCharacters: async () => characters,
      loadEnabledModuleIds: async () => ['alpha'],
      now,
      providers: [provider('alpha', invoke)],
    })

    expect(result.activities.map(({ id }) => id)).toStrictEqual([
      'alpha:activity:offset-early',
      'alpha:activity:offset-late',
      'alpha:activity:earlier',
      'alpha:activity:later',
      'alpha:activity:passive-high',
      'alpha:activity:duplicate',
    ])
    expect(result.activities.at(-1)).toMatchObject({
      eligibleCharacterIds: [9001],
      participation: [{ characterId: 9001, contribution: null, state: 'eligible' }],
    })
  })

  test('invalidates a provider on conflicting duplicates or undeclared links', async () => {
    const conflict = provider(
      'alpha',
      vi.fn().mockResolvedValue({
        activities: [activity('same'), activity('same', { title: 'Different' })],
        freshness: freshness(),
      }),
    )
    const deadLink = provider(
      'beta',
      vi.fn().mockResolvedValue({
        activities: [
          activity('dead-link', { linkTarget: { pageId: 'missing-page', characterId: null } }),
        ],
        freshness: freshness(),
      }),
    )
    const contradictoryParticipation = provider(
      'gamma',
      vi.fn().mockResolvedValue({
        activities: [
          activity('contradictory', {
            participation: [
              { characterId: 9001, state: 'participating', contribution: 2 },
              { characterId: 9001, state: 'completed', contribution: 2 },
            ],
          }),
        ],
        freshness: freshness(),
      }),
    )
    const contradictoryContribution = provider(
      'delta',
      vi.fn().mockResolvedValue({
        activities: [
          activity('contradictory-contribution', {
            participation: [
              { characterId: 9001, state: 'participating', contribution: 2 },
              { characterId: 9001, state: 'participating', contribution: 5 },
            ],
          }),
        ],
        freshness: freshness(),
      }),
    )
    const duplicateContribution = provider(
      'epsilon',
      vi.fn().mockResolvedValue({
        activities: [
          activity('duplicate-contribution', {
            participation: [{ characterId: 9001, state: 'participating', contribution: 2 }],
          }),
          activity('duplicate-contribution', {
            participation: [{ characterId: 9001, state: 'participating', contribution: 5 }],
          }),
        ],
        freshness: freshness(),
      }),
    )
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize: authorized,
      loadCharacters: async () => characters,
      loadEnabledModuleIds: async () => ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      now,
      providers: [
        conflict,
        deadLink,
        contradictoryParticipation,
        contradictoryContribution,
        duplicateContribution,
      ],
    })

    expect(result.activities).toStrictEqual([])
    expect(result.sources.every(({ freshness: value }) => value.state === 'unavailable')).toBe(true)
  })

  test('downgrades activity and source freshness after the declared stale interval', async () => {
    const oldFreshness = {
      collectedAt: '2026-09-02T11:00:00.000Z',
      state: 'current' as const,
    }
    const olderFreshness = {
      collectedAt: '2026-09-02T12:30:00.000+02:00',
      state: 'stale' as const,
    }
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize: authorized,
      loadCharacters: async () => characters,
      loadEnabledModuleIds: async () => ['alpha', 'beta'],
      now,
      providers: [
        provider(
          'alpha',
          vi.fn().mockResolvedValue({
            freshness: oldFreshness,
            activities: [activity('old', { freshness: oldFreshness })],
          }),
        ),
        provider(
          'beta',
          vi.fn().mockResolvedValue({
            freshness: olderFreshness,
            activities: [activity('older', { freshness: olderFreshness })],
          }),
        ),
      ],
    })

    expect(result.sources[0]?.freshness.state).toBe('stale')
    expect(result.activities[0]?.freshness.state).toBe('stale')
    expect(result).toMatchObject({
      stale: true,
      validatedAt: '2026-09-02T12:30:00.000+02:00',
    })
  })

  test('bounds a provider timeout without failing the aggregate response', async () => {
    const invoke = vi.fn<PlatformInstalledActivityProviderDescriptor['invoke']>(
      () => new Promise(() => undefined),
    )
    const result = await aggregateOrganizationActivities('user-1', organization, {
      authorize: authorized,
      loadCharacters: async () => characters,
      loadEnabledModuleIds: async () => ['alpha'],
      now,
      providers: [provider('alpha', invoke)],
      timeoutMilliseconds: 5,
    })

    expect(result.activities).toStrictEqual([])
    expect(result.sources[0]?.freshness.state).toBe('unavailable')
    expect(invoke.mock.calls[0]![0].signal.aborted).toBe(true)
  })
})

function provider(
  moduleId: string,
  invoke: PlatformInstalledActivityProviderDescriptor['invoke'],
  sectionId?: string,
): PlatformInstalledActivityProviderDescriptor {
  return {
    audience: 'member',
    coreDataProducts: [],
    freshness: { staleAfterSeconds: 300 },
    invoke,
    moduleId,
    pageIds: ['activity-page'],
    providerId: 'activity',
    publisherPackage: `@example/${moduleId}-manifest`,
    requiredPermission: `${moduleId}.view`,
    sectionId,
  }
}

function activity(id: string, overrides: Partial<PlatformActivity> = {}): PlatformActivity {
  return {
    deadline: null,
    eligibleCharacterIds: [9001],
    freshness: freshness(),
    id,
    kind: 'project',
    linkTarget: { characterId: null, pageId: 'activity-page' },
    objective: null,
    organizationPriority: 10,
    participation: [{ characterId: 9001, state: 'eligible', contribution: null }],
    progress: null,
    requiredAction: null,
    reward: null,
    state: 'Active',
    summary: null,
    title: id,
    ...overrides,
  }
}

function freshness() {
  return { collectedAt: '2026-09-02T11:59:00.000Z', state: 'current' as const }
}

async function authorized() {
  return {
    authorized: true as const,
    context: {
      audience: 'member' as const,
      entitlementScope: 'all' as const,
      organizationVersion: 7,
      requiredPermission: 'alpha.view',
    },
  }
}
