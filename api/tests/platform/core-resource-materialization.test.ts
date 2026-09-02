import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  managedCorporations: vi.fn(),
  corporationRoster: vi.fn(),
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
      [{ validatedAt: null, lastFailureClass: 'esi-unavailable' }],
      [{ organizationVersion: 8 }],
    ])
    mocks.managedCorporations.mockResolvedValue({
      outcome: 'refreshed',
      addedIds: [98_000_002],
      removedIds: [98_000_003],
    })

    await expect(
      materializeCoreResourceObservation(database, {
        resourceId: 'managed-corporations',
        subject: allianceSubject(),
        data: [98_000_003, '98000002', 98_000_002],
        validatedAt,
        authorizationGeneration: null,
      }),
    ).resolves.toEqual({
      organizationVersion: 8,
      affectedCorporationIds: [98_000_002, 98_000_003],
      recomputeAllAccounts: true,
    })
    expect(mocks.managedCorporations).toHaveBeenCalledWith(database, {
      organizationVersion: 8,
      allianceId: 99_000_001,
      corporationIds: [98_000_002, 98_000_003],
      validatedAt,
    })
  })

  test('returns no convergence request for unchanged or detached alliance observations', async () => {
    const unchangedDatabase = databaseWithResults([
      [{ validatedAt, lastFailureClass: null }],
      [{ organizationVersion: 8 }],
    ])
    mocks.managedCorporations.mockResolvedValue({ outcome: 'unchanged' })

    await expect(
      materializeCoreResourceObservation(unchangedDatabase, {
        resourceId: 'managed-corporations',
        subject: allianceSubject(),
        data: [],
        validatedAt,
        authorizationGeneration: null,
      }),
    ).resolves.toBeNull()

    const detachedDatabase = databaseWithResults([[], []])
    await expect(
      materializeCoreResourceObservation(detachedDatabase, {
        resourceId: 'managed-corporations',
        subject: allianceSubject(),
        data: [],
        validatedAt,
        authorizationGeneration: null,
      }),
    ).resolves.toBeNull()
    expect(mocks.managedCorporations).toHaveBeenCalledOnce()
  })

  test('materializes an authorized corporation roster', async () => {
    const database = databaseWithResults([
      [{ sourceId: 'source-1', organizationVersion: 8, characterId: 90_000_001 }],
    ])
    mocks.corporationRoster.mockResolvedValue({ outcome: 'refreshed' })

    await expect(
      materializeCoreResourceObservation(database, {
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        data: [90_000_003, 90_000_002],
        validatedAt,
        authorizationGeneration: 4,
      }),
    ).resolves.toEqual({
      organizationVersion: 8,
      affectedCorporationIds: [],
      recomputeAllAccounts: false,
    })
    expect(mocks.corporationRoster).toHaveBeenCalledWith(database, {
      organizationVersion: 8,
      corporationId: 98_000_001,
      sourceId: 'source-1',
      characterId: 90_000_001,
      tokenVersion: 4,
      characterIds: [90_000_002, 90_000_003],
      validatedAt,
    })
  })

  test('ignores unauthorized, detached, and unchanged corporation rosters', async () => {
    const unauthorizedDatabase = databaseWithResults([])
    await expect(
      materializeCoreResourceObservation(unauthorizedDatabase, {
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        data: [],
        validatedAt,
        authorizationGeneration: null,
      }),
    ).resolves.toBeNull()

    const detachedDatabase = databaseWithResults([[]])
    await expect(
      materializeCoreResourceObservation(detachedDatabase, {
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        data: [],
        validatedAt,
        authorizationGeneration: 4,
      }),
    ).resolves.toBeNull()

    const unchangedDatabase = databaseWithResults([
      [{ sourceId: 'source-1', organizationVersion: 8, characterId: 90_000_001 }],
    ])
    mocks.corporationRoster.mockResolvedValue({ outcome: 'unchanged' })
    await expect(
      materializeCoreResourceObservation(unchangedDatabase, {
        resourceId: 'corporation-roster',
        subject: corporationSubject(),
        data: [],
        validatedAt,
        authorizationGeneration: 4,
      }),
    ).resolves.toBeNull()
  })

  test('rejects unknown resources and malformed observations', async () => {
    const database = databaseWithResults([])
    const base = {
      subject: corporationSubject(),
      validatedAt,
      authorizationGeneration: 4,
    }

    await expect(
      materializeCoreResourceObservation(database, {
        ...base,
        resourceId: 'unknown',
        data: [],
      }),
    ).rejects.toThrow('Unknown core resource unknown')
    await expect(
      materializeCoreResourceObservation(database, {
        ...base,
        resourceId: 'unknown',
        data: {},
      }),
    ).rejects.toThrow('Core organization resource data must be an ID array')
    await expect(
      materializeCoreResourceObservation(database, {
        ...base,
        resourceId: 'unknown',
        data: [0, Number.MAX_SAFE_INTEGER + 1],
      }),
    ).rejects.toThrow('Core organization resource data contains an invalid ID')
  })
})

function allianceSubject() {
  return {
    kind: 'alliance' as const,
    lifecycleId: 'alliance-lifecycle',
    allianceId: 99_000_001,
  }
}

function corporationSubject() {
  return {
    kind: 'corporation' as const,
    lifecycleId: 'corporation-lifecycle',
    corporationId: 98_000_001,
  }
}

function databaseWithResults(results: unknown[][]) {
  return {
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(() => query(results.shift() ?? [])),
  } as never
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where']) builder[method] = () => builder
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
