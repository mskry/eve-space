import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }))

vi.mock('../../src/db/client.js', () => ({
  db: { select: vi.fn(() => query(mocks.rows)) },
}))

import { loadOrganizationActivityCharacters } from '../../src/organization/activity-context.js'

const now = new Date('2026-09-02T12:00:00.000Z')

describe('organization activity character context', () => {
  beforeEach(() => {
    mocks.rows = []
  })

  test('classifies every attached character with bounded affiliation freshness', async () => {
    mocks.rows = [
      row({ managedCorporationId: 98_000_001 }),
      row({
        characterId: 9002,
        exceptionId: 'exception-1',
        managedCorporationId: null,
        name: 'External',
        nextAffiliationCheck: new Date('2026-09-02T11:00:00.000Z'),
        subjectLifecycleId: '59616274-5228-41f2-813d-9caf9f793ef3',
      }),
      row({
        affiliationCheckedAt: null,
        affiliationResolutionState: 'pending',
        characterId: 9003,
        managedCorporationId: 98_000_001,
        name: 'Pending',
        subjectLifecycleId: '95775f21-7ad8-4f2c-a6e2-7dbd967f886e',
      }),
    ]

    await expect(loadOrganizationActivityCharacters('user-1', 7, now)).resolves.toStrictEqual([
      expect.objectContaining({
        affiliationFreshness: 'fresh',
        characterId: 9001,
        membership: 'managed',
      }),
      expect.objectContaining({
        affiliationFreshness: 'stale',
        characterId: 9002,
        membership: 'approved-external',
      }),
      expect.objectContaining({
        affiliationCheckedAt: null,
        affiliationFreshness: 'unavailable',
        characterId: 9003,
        membership: 'managed',
      }),
    ])
  })

  test('rejects stale-version or unclassified character context', async () => {
    await expect(loadOrganizationActivityCharacters('user-1', 7, now)).rejects.toThrow(
      'Organization activity context is not current',
    )

    mocks.rows = [row({ exceptionId: null, managedCorporationId: null })]
    await expect(loadOrganizationActivityCharacters('user-1', 7, now)).rejects.toThrow(
      'unclassified character',
    )
  })
})

function row(overrides: Record<string, unknown> = {}) {
  return {
    affiliationCheckedAt: new Date('2026-09-02T11:55:00.000Z'),
    affiliationResolutionState: 'resolved',
    allianceId: null,
    characterId: 9001,
    corporationId: 98_000_001,
    exceptionId: null,
    isMain: true,
    managedCorporationId: 98_000_001,
    name: 'Main',
    nextAffiliationCheck: new Date('2026-09-02T12:05:00.000Z'),
    subjectLifecycleId: '6f466907-5fb2-4756-bd22-831f5a0293ba',
    ...overrides,
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
