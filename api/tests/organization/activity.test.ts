import type {
  PlatformActivity,
  PlatformActivityProviderCharacter,
  PlatformInstalledActivityProviderDescriptor,
} from '@eve-space/platform-module-contract'
import { describe, expect, test, vi } from 'vitest'
import { aggregateOrganizationActivities } from '../../src/organization/activity.js'

const now = new Date('2026-09-02T12:00:00.000Z')
const organization = {
  organizationVersion: 7,
  state: 'compliant' as const,
  evidenceFreshness: 'fresh' as const,
  reviewDeadline: null,
  accessValidUntil: new Date('2026-09-02T13:00:00.000Z'),
  blocked: false,
}
const characters: readonly PlatformActivityProviderCharacter[] = [
  {
    characterId: 9001,
    subjectLifecycleId: '6f466907-5fb2-4756-bd22-831f5a0293ba',
    name: 'Main',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    membership: 'managed',
    affiliationFreshness: 'fresh',
    affiliationCheckedAt: '2026-09-02T11:55:00.000Z',
  },
]

describe('organization activity aggregation', () => {
  test('does not authorize or invoke disabled providers', async () => {
    const invoke = vi.fn()
    const authorize = vi.fn()
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [provider('alpha', invoke)],
      loadEnabledModuleIds: async () => [],
      authorize,
      loadCharacters: vi.fn(),
      now,
    })

    expect(result.activities).toEqual([])
    expect(result.sources).toEqual([])
    expect(authorize).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  test('never invokes unauthorized providers or loads private character context', async () => {
    const invoke = vi.fn()
    const loadCharacters = vi.fn()
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [provider('alpha', invoke)],
      loadEnabledModuleIds: async () => ['alpha'],
      authorize: vi.fn().mockResolvedValue({ authorized: false, reason: 'permission' }),
      loadCharacters,
      now,
    })

    expect(result.activities).toEqual([])
    expect(result.sources).toEqual([])
    expect(loadCharacters).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  test('degrades authorized providers when bounded character context is unavailable', async () => {
    const invoke = vi.fn()
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [provider('alpha', invoke)],
      loadEnabledModuleIds: async () => ['alpha'],
      authorize: authorized,
      loadCharacters: async () => {
        throw new Error('Organization version changed')
      },
      now,
    })

    expect(result.activities).toEqual([])
    expect(result.sources[0]?.freshness.state).toBe('unavailable')
    expect(invoke).not.toHaveBeenCalled()
  })

  test('isolates provider failures and strictly projects member-safe fields', async () => {
    const successful = provider(
      'alpha',
      vi.fn().mockResolvedValue({
        freshness: freshness(),
        activities: [{ ...activity('safe'), rawEsi: { directorIds: [42] }, accessToken: 'secret' }],
      } as never),
    )
    const healthy = provider(
      'beta',
      vi.fn().mockResolvedValue({ freshness: freshness(), activities: [activity('healthy')] }),
    )
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [successful, healthy],
      loadEnabledModuleIds: async () => ['alpha', 'beta'],
      authorize: authorized,
      loadCharacters: async () => characters,
      now,
    })

    expect(result.activities.map(({ id }) => id)).toEqual(['beta:activity:healthy'])
    expect(result.sources).toEqual([
      expect.objectContaining({
        sourceId: 'alpha:activity',
        freshness: { state: 'unavailable', collectedAt: null },
      }),
      expect.objectContaining({
        sourceId: 'beta:activity',
        freshness: freshness(),
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
      freshness: freshness(),
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
          participation: [{ characterId: 9001, state: 'eligible' }],
        }),
      ],
    })
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [provider('alpha', invoke)],
      loadEnabledModuleIds: async () => ['alpha'],
      authorize: authorized,
      loadCharacters: async () => characters,
      now,
    })

    expect(result.activities.map(({ id }) => id)).toEqual([
      'alpha:activity:offset-early',
      'alpha:activity:offset-late',
      'alpha:activity:earlier',
      'alpha:activity:later',
      'alpha:activity:passive-high',
      'alpha:activity:duplicate',
    ])
    expect(result.activities.at(-1)).toMatchObject({
      eligibleCharacterIds: [9001],
      participation: [{ characterId: 9001, state: 'eligible' }],
    })
  })

  test('invalidates a provider on conflicting duplicates or undeclared links', async () => {
    const conflict = provider(
      'alpha',
      vi.fn().mockResolvedValue({
        freshness: freshness(),
        activities: [activity('same'), activity('same', { title: 'Different' })],
      }),
    )
    const deadLink = provider(
      'beta',
      vi.fn().mockResolvedValue({
        freshness: freshness(),
        activities: [
          activity('dead-link', { linkTarget: { pageId: 'missing-page', characterId: null } }),
        ],
      }),
    )
    const contradictoryParticipation = provider(
      'gamma',
      vi.fn().mockResolvedValue({
        freshness: freshness(),
        activities: [
          activity('contradictory', {
            participation: [
              { characterId: 9001, state: 'participating' },
              { characterId: 9001, state: 'completed' },
            ],
          }),
        ],
      }),
    )
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [conflict, deadLink, contradictoryParticipation],
      loadEnabledModuleIds: async () => ['alpha', 'beta', 'gamma'],
      authorize: authorized,
      loadCharacters: async () => characters,
      now,
    })

    expect(result.activities).toEqual([])
    expect(result.sources.every(({ freshness: value }) => value.state === 'unavailable')).toBe(true)
  })

  test('downgrades activity and source freshness after the declared stale interval', async () => {
    const oldFreshness = {
      state: 'current' as const,
      collectedAt: '2026-09-02T11:00:00.000Z',
    }
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [
        provider(
          'alpha',
          vi.fn().mockResolvedValue({
            freshness: oldFreshness,
            activities: [activity('old', { freshness: oldFreshness })],
          }),
        ),
      ],
      loadEnabledModuleIds: async () => ['alpha'],
      authorize: authorized,
      loadCharacters: async () => characters,
      now,
    })

    expect(result.sources[0]?.freshness.state).toBe('stale')
    expect(result.activities[0]?.freshness.state).toBe('stale')
  })

  test('bounds a provider timeout without failing the aggregate response', async () => {
    const invoke = vi.fn<PlatformInstalledActivityProviderDescriptor['invoke']>(
      () => new Promise(() => undefined),
    )
    const result = await aggregateOrganizationActivities('user-1', organization, {
      providers: [provider('alpha', invoke)],
      loadEnabledModuleIds: async () => ['alpha'],
      authorize: authorized,
      loadCharacters: async () => characters,
      timeoutMilliseconds: 5,
      now,
    })

    expect(result.activities).toEqual([])
    expect(result.sources[0]?.freshness.state).toBe('unavailable')
    expect(invoke.mock.calls[0]![0].signal.aborted).toBe(true)
  })
})

function provider(
  moduleId: string,
  invoke: PlatformInstalledActivityProviderDescriptor['invoke'],
): PlatformInstalledActivityProviderDescriptor {
  return {
    moduleId,
    providerId: 'activity',
    audience: 'member',
    requiredPermission: `${moduleId}.view`,
    freshness: { staleAfterSeconds: 300 },
    pageIds: ['activity-page'],
    invoke,
  }
}

function activity(id: string, overrides: Partial<PlatformActivity> = {}): PlatformActivity {
  return {
    id,
    kind: 'project',
    title: id,
    summary: null,
    requiredAction: null,
    organizationPriority: 10,
    deadline: null,
    eligibleCharacterIds: [9001],
    participation: [{ characterId: 9001, state: 'eligible' }],
    linkTarget: { pageId: 'activity-page', characterId: null },
    freshness: freshness(),
    ...overrides,
  }
}

function freshness() {
  return { state: 'current' as const, collectedAt: '2026-09-02T11:59:00.000Z' }
}

async function authorized() {
  return {
    authorized: true as const,
    context: {
      organizationVersion: 7,
      audience: 'member' as const,
      requiredPermission: 'alpha.view',
      entitlementScope: 'all' as const,
    },
  }
}
