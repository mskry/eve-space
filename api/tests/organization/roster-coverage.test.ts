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

  test('projects configured corporation coverage and unregistered roster observations', async () => {
    selectResults(
      [
        {
          organizationVersion: 4,
          corporationId: 98_000_001,
          managedLastObservedAt: new Date('2026-09-01T10:00:00.000Z'),
          sourceId: 'source-1',
          sourceCharacterId: 1_404_328_063,
          subjectLifecycleId: 'lifecycle-1',
          attemptedAt: new Date('2026-09-01T11:00:00.000Z'),
        },
        {
          organizationVersion: 4,
          corporationId: 98_000_002,
          managedLastObservedAt: new Date('2026-09-01T10:30:00.000Z'),
          sourceId: null,
          sourceCharacterId: null,
          subjectLifecycleId: null,
          attemptedAt: null,
        },
      ],
      [
        {
          corporationId: 98_000_001,
          characterId: 1_404_328_064,
          observedAt: new Date('2026-09-01T10:15:00.000Z'),
        },
      ],
      [],
      [
        {
          organizationType: 'corporation',
          organizationId: 98_000_001,
          organizationVersion: 4,
          subjectLifecycleId: 'managed-lifecycle',
          configuredAt: new Date('2026-09-01T09:00:00.000Z'),
        },
      ],
    )
    mocks.getCollectionStatus.mockResolvedValue({
      status: 'authorization-required',
      validatedAt: null,
      attemptedAt: '2026-09-01T11:00:00.000Z',
      lastFailureClass: 'authorization',
    })

    await expect(listOrganizationRosterCoverage()).resolves.toEqual({
      managedCorporations: {
        status: 'current',
        validatedAt: '2026-09-01T09:00:00.000Z',
        attemptedAt: '2026-09-01T09:00:00.000Z',
        lastFailureClass: null,
      },
      corporations: [
        {
          organizationVersion: 4,
          corporationId: 98_000_001,
          managedLastObservedAt: '2026-09-01T10:00:00.000Z',
          source: { sourceId: 'source-1', characterId: 1_404_328_063 },
          status: 'unauthorized',
          validatedAt: null,
          attemptedAt: '2026-09-01T11:00:00.000Z',
          lastFailureClass: 'authorization',
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
    })
    expect(mocks.getCollectionStatus).toHaveBeenCalledOnce()
  })

  test('projects collected alliance and pending corporation coverage', async () => {
    selectResults(
      [
        {
          organizationVersion: 7,
          corporationId: 98_000_003,
          managedLastObservedAt: new Date('2026-09-02T10:00:00.000Z'),
          sourceId: 'source-3',
          sourceCharacterId: 1_404_328_065,
          subjectLifecycleId: 'lifecycle-3',
          attemptedAt: null,
        },
      ],
      [],
      [],
      [
        {
          organizationType: 'alliance',
          organizationId: 99_000_001,
          organizationVersion: 7,
          subjectLifecycleId: 'alliance-lifecycle',
          configuredAt: new Date('2026-09-02T09:00:00.000Z'),
        },
      ],
    )
    mocks.getCollectionStatus
      .mockResolvedValueOnce({
        status: 'never-collected',
        validatedAt: null,
        attemptedAt: null,
        lastFailureClass: null,
      })
      .mockResolvedValueOnce({
        status: 'stale',
        validatedAt: '2026-09-02T08:00:00.000Z',
        attemptedAt: '2026-09-02T10:00:00.000Z',
        lastFailureClass: 'esi-unavailable',
      })

    const result = await listOrganizationRosterCoverage()

    expect(result.managedCorporations).toEqual({
      status: 'stale',
      validatedAt: '2026-09-02T08:00:00.000Z',
      attemptedAt: '2026-09-02T10:00:00.000Z',
      lastFailureClass: 'esi-unavailable',
    })
    expect(result.corporations[0]).toMatchObject({ status: 'pending', attemptedAt: null })
    expect(mocks.getCollectionStatus).toHaveBeenNthCalledWith(2, {
      moduleId: 'core',
      resourceId: 'managed-corporations',
      subjectKind: 'alliance',
      subjectLifecycleId: 'alliance-lifecycle',
      subjectId: '99000001',
    })
  })
})

function selectResults(...results: unknown[][]) {
  for (const result of results) mocks.select.mockReturnValueOnce(query(result))
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy'])
    builder[method] = () => builder
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
