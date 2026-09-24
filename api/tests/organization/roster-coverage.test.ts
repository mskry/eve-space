import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCollectionStatus: vi.fn(),
  select: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../../src/platform/collection-status.js', () => ({
  getInstalledResourceCollectionStatus: mocks.getCollectionStatus,
}))

import { listOrganizationRosterCoverage } from '../../src/organization/roster-coverage.js'

describe('organization roster coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('projects configured corporation coverage and current unregistered observations', async () => {
    selectResults(
      [
        {
          attemptedAt: new Date('2026-09-01T11:00:00.000Z'),
          corporationId: 98_000_001,
          managedLastObservedAt: new Date('2026-09-01T10:00:00.000Z'),
          organizationVersion: 4,
          sourceCharacterId: 1_404_328_063,
          sourceId: 'source-1',
          subjectLifecycleId: 'lifecycle-1',
        },
        {
          attemptedAt: null,
          corporationId: 98_000_002,
          managedLastObservedAt: new Date('2026-09-01T10:30:00.000Z'),
          organizationVersion: 4,
          sourceCharacterId: null,
          sourceId: null,
          subjectLifecycleId: null,
        },
      ],
      [
        {
          characterId: 1_404_328_064,
          corporationId: 98_000_001,
          observedAt: new Date('2026-09-01T10:15:00.000Z'),
        },
      ],
      [],
      [
        {
          configuredAt: new Date('2026-09-01T09:00:00.000Z'),
          organizationId: 98_000_001,
          organizationType: 'corporation',
          organizationVersion: 4,
          subjectLifecycleId: 'managed-lifecycle',
        },
      ],
    )
    mocks.getCollectionStatus.mockResolvedValue({
      attemptedAt: '2026-09-01T11:00:00.000Z',
      lastFailureClass: null,
      status: 'current',
      validatedAt: '2026-09-01T10:15:00.000Z',
    })

    await expect(listOrganizationRosterCoverage()).resolves.toStrictEqual({
      corporations: [
        {
          organizationVersion: 4,
          corporationId: 98_000_001,
          managedLastObservedAt: '2026-09-01T10:00:00.000Z',
          source: { sourceId: 'source-1', characterId: 1_404_328_063 },
          status: 'current',
          validatedAt: '2026-09-01T10:15:00.000Z',
          attemptedAt: '2026-09-01T11:00:00.000Z',
          lastFailureClass: null,
          unregisteredCharacters: [
            {
              characterId: 1_404_328_064,
              observedAt: '2026-09-01T10:15:00.000Z',
            },
          ],
        },
        {
          organizationVersion: 4,
          corporationId: 98_000_002,
          managedLastObservedAt: '2026-09-01T10:30:00.000Z',
          source: null,
          status: 'never-configured',
          validatedAt: null,
          attemptedAt: null,
          lastFailureClass: null,
          unregisteredCharacters: [],
        },
      ],
      managedCorporations: {
        attemptedAt: '2026-09-01T09:00:00.000Z',
        lastFailureClass: null,
        status: 'current',
        validatedAt: '2026-09-01T09:00:00.000Z',
      },
      stale: false,
    })
    expect(mocks.getCollectionStatus).toHaveBeenCalledOnce()
  })

  test('projects collected alliance and stale corporation coverage', async () => {
    selectResults(
      [
        {
          attemptedAt: null,
          corporationId: 98_000_003,
          managedLastObservedAt: new Date('2026-09-02T10:00:00.000Z'),
          organizationVersion: 7,
          sourceCharacterId: 1_404_328_065,
          sourceId: 'source-3',
          subjectLifecycleId: 'lifecycle-3',
        },
      ],
      [],
      [],
      [
        {
          configuredAt: new Date('2026-09-02T09:00:00.000Z'),
          organizationId: 99_000_001,
          organizationType: 'alliance',
          organizationVersion: 7,
          subjectLifecycleId: 'alliance-lifecycle',
        },
      ],
    )
    mocks.getCollectionStatus
      .mockResolvedValueOnce({
        attemptedAt: '2026-09-02T09:30:00.000Z',
        lastFailureClass: 'esi-cooldown',
        status: 'stale',
        validatedAt: '2026-09-02T09:30:00.000+02:00',
      })
      .mockResolvedValueOnce({
        attemptedAt: '2026-09-02T10:00:00.000Z',
        lastFailureClass: 'esi-unavailable',
        status: 'stale',
        validatedAt: '2026-09-02T08:00:00.000Z',
      })

    const result = await listOrganizationRosterCoverage()

    expect(result.managedCorporations).toStrictEqual({
      attemptedAt: '2026-09-02T10:00:00.000Z',
      lastFailureClass: 'esi-unavailable',
      status: 'stale',
      validatedAt: '2026-09-02T08:00:00.000Z',
    })
    expect(result.corporations[0]).toMatchObject({ attemptedAt: null, status: 'stale' })
    expect(result).toMatchObject({
      refreshFailureClass: 'esi-cooldown',
      stale: true,
      validatedAt: '2026-09-02T09:30:00.000+02:00',
    })
    expect(mocks.getCollectionStatus).toHaveBeenNthCalledWith(2, {
      moduleId: 'core',
      resourceId: 'managed-corporations',
      subjectId: '99000001',
      subjectKind: 'alliance',
      subjectLifecycleId: 'alliance-lifecycle',
    })
  })
})

function selectResults(...results: unknown[][]) {
  for (const result of results) {
    mocks.select.mockReturnValueOnce(query(result))
  }
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
    builder[method] = () => builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
