import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  corporationRoster: vi.fn(),
  managedCorporations: vi.fn(),
}))

vi.mock('../../src/organization/managed-corporations.js', () => ({
  materializeManagedAllianceCorporations: mocks.managedCorporations,
}))
vi.mock('../../src/organization/roster-collection.js', () => ({
  materializeCorporationRoster: mocks.corporationRoster,
}))

import { materializeCoreResourceObservation } from '../../src/platform/core-resource-materialization.js'

const validatedAt = new Date('2026-09-01T12:00:00.000Z')

describe('core resource materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('materializes changed managed corporations and requests full recovery convergence', async () => {
    const database = databaseWithResults([
      [{ lastFailureClass: 'esi-unavailable', validatedAt: null }],
      [{ organizationVersion: 8 }],
    ])
    mocks.managedCorporations.mockResolvedValue({
      addedIds: [98_000_002],
      outcome: 'refreshed',
      removedIds: [98_000_003],
    })

    await expect(
      materializeCoreResourceObservation(database, {
        authorizationGeneration: null,
        data: [98_000_003, '98000002', 98_000_002],
        resourceId: 'managed-corporations',
        subject: allianceSubject(),
        validatedAt,
      }),
    ).resolves.toStrictEqual({
      affectedCorporationIds: [98_000_002, 98_000_003],
      organizationVersion: 8,
      recomputeAllAccounts: true,
    })
    expect(mocks.managedCorporations).toHaveBeenCalledWith(database, {
      allianceId: 99_000_001,
      corporationIds: [98_000_002, 98_000_003],
      organizationVersion: 8,
      validatedAt,
    })
  })

  test('returns no convergence request for unchanged or detached alliance observations', async () => {
    const unchangedDatabase = databaseWithResults([
      [{ lastFailureClass: null, validatedAt }],
      [{ organizationVersion: 8 }],
    ])
    mocks.managedCorporations.mockResolvedValue({ outcome: 'unchanged' })

    await expect(
      materializeCoreResourceObservation(unchangedDatabase, {
        authorizationGeneration: null,
        data: [],
        resourceId: 'managed-corporations',
        subject: allianceSubject(),
        validatedAt,
      }),
    ).resolves.toBeNull()

    const detachedDatabase = databaseWithResults([[], []])
    await expect(
      materializeCoreResourceObservation(detachedDatabase, {
        authorizationGeneration: null,
        data: [],
        resourceId: 'managed-corporations',
        subject: allianceSubject(),
        validatedAt,
      }),
    ).resolves.toBeNull()
    expect(mocks.managedCorporations).toHaveBeenCalledOnce()
  })

  test.each([
    [new Date('2026-09-01T11:59:00.000Z'), true],
    [new Date('2026-09-01T12:01:00.000Z'), false],
  ] as const)(
    'marks full convergence as %s when alliance authority crosses its freshness boundary',
    async (nextEligibleAt, recomputeAllAccounts) => {
      const database = databaseWithResults([
        [
          {
            lastFailureClass: null,
            nextEligibleAt,
            validatedAt: new Date('2026-09-01T11:00:00.000Z'),
          },
        ],
        [{ organizationVersion: 8 }],
      ])
      mocks.managedCorporations.mockResolvedValue({
        addedIds: [],
        outcome: 'refreshed',
        removedIds: [],
      })

      await expect(
        materializeCoreResourceObservation(database, {
          authorizationGeneration: null,
          data: [98_000_001],
          resourceId: 'managed-corporations',
          subject: allianceSubject(),
          validatedAt,
        }),
      ).resolves.toMatchObject({ recomputeAllAccounts })
    },
  )

  test('materializes an authorized corporation roster', async () => {
    const database = databaseWithResults([
      [{ characterId: 90_000_001, organizationVersion: 8, sourceId: 'source-1' }],
    ])
    mocks.corporationRoster.mockResolvedValue({ outcome: 'refreshed' })

    await expect(
      materializeCoreResourceObservation(database, {
        authorizationGeneration: 4,
        data: [90_000_003, 90_000_002],
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        validatedAt,
      }),
    ).resolves.toStrictEqual({
      affectedCorporationIds: [],
      organizationVersion: 8,
      recomputeAllAccounts: false,
    })
    expect(mocks.corporationRoster).toHaveBeenCalledWith(database, {
      characterId: 90_000_001,
      characterIds: [90_000_002, 90_000_003],
      corporationId: 98_000_001,
      organizationVersion: 8,
      sourceId: 'source-1',
      tokenVersion: 4,
      validatedAt,
    })
  })

  test('ignores unauthorized, detached, and unchanged corporation rosters', async () => {
    const unauthorizedDatabase = databaseWithResults([])
    await expect(
      materializeCoreResourceObservation(unauthorizedDatabase, {
        authorizationGeneration: null,
        data: [],
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        validatedAt,
      }),
    ).resolves.toBeNull()

    const detachedDatabase = databaseWithResults([[]])
    await expect(
      materializeCoreResourceObservation(detachedDatabase, {
        authorizationGeneration: 4,
        data: [],
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        validatedAt,
      }),
    ).resolves.toBeNull()

    const unchangedDatabase = databaseWithResults([
      [{ characterId: 90_000_001, organizationVersion: 8, sourceId: 'source-1' }],
    ])
    mocks.corporationRoster.mockResolvedValue({ outcome: 'unchanged' })
    await expect(
      materializeCoreResourceObservation(unchangedDatabase, {
        authorizationGeneration: 4,
        data: [],
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        validatedAt,
      }),
    ).resolves.toBeNull()
  })

  test('rejects unknown resources and malformed observations', async () => {
    const database = databaseWithResults([])
    const base = {
      authorizationGeneration: 4,
      subject: corporationSubject(),
      validatedAt,
    }

    await expect(
      materializeCoreResourceObservation(database, {
        ...base,
        data: [],
        resourceId: 'unknown',
      }),
    ).rejects.toThrow('Unknown core resource unknown')
    await expect(
      materializeCoreResourceObservation(database, {
        ...base,
        data: {},
        resourceId: 'unknown',
      }),
    ).rejects.toThrow('Core organization resource data must be an ID array')
    await expect(
      materializeCoreResourceObservation(database, {
        ...base,
        data: [0, Number.MAX_SAFE_INTEGER + 1],
        resourceId: 'unknown',
      }),
    ).rejects.toThrow('Core organization resource data contains an invalid ID')
  })
})

function allianceSubject() {
  return {
    allianceId: 99_000_001,
    kind: 'alliance' as const,
    lifecycleId: 'alliance-lifecycle',
  }
}

function corporationSubject() {
  return {
    corporationId: 98_000_001,
    kind: 'corporation' as const,
    lifecycleId: 'corporation-lifecycle',
  }
}

function databaseWithResults(results: unknown[][]) {
  return {
    delete: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(() => query(results.shift() ?? [])),
    update: vi.fn(),
  } as never
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where']) {
    builder[method] = () => builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
