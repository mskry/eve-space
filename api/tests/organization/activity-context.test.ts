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
        subjectLifecycleId: '59616274-5228-41f2-813d-9caf9f793ef3',
        name: 'External',
        managedCorporationId: null,
        exceptionId: 'exception-1',
        nextAffiliationCheck: new Date('2026-09-02T11:00:00.000Z'),
      }),
      row({
        characterId: 9003,
        subjectLifecycleId: '95775f21-7ad8-4f2c-a6e2-7dbd967f886e',
        name: 'Pending',
        managedCorporationId: 98_000_001,
        affiliationCheckedAt: null,
        affiliationResolutionState: 'pending',
      }),
    ]

    await expect(loadOrganizationActivityCharacters('user-1', 7, now)).resolves.toEqual([
      expect.objectContaining({
        characterId: 9001,
        membership: 'managed',
        affiliationFreshness: 'fresh',
      }),
      expect.objectContaining({
        characterId: 9002,
        membership: 'approved-external',
        affiliationFreshness: 'stale',
      }),
      expect.objectContaining({
        characterId: 9003,
        membership: 'managed',
        affiliationFreshness: 'unavailable',
        affiliationCheckedAt: null,
      }),
    ])
  })

  test('rejects stale-version or unclassified character context', async () => {
    await expect(loadOrganizationActivityCharacters('user-1', 7, now)).rejects.toThrow(
      'Organization activity context is not current',
    )

    mocks.rows = [row({ managedCorporationId: null, exceptionId: null })]
    await expect(loadOrganizationActivityCharacters('user-1', 7, now)).rejects.toThrow(
      'unclassified character',
    )
  })
})

function row(overrides: Record<string, unknown> = {}) {
  return {
    characterId: 9001,
    subjectLifecycleId: '6f466907-5fb2-4756-bd22-831f5a0293ba',
    name: 'Main',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    affiliationCheckedAt: new Date('2026-09-02T11:55:00.000Z'),
    nextAffiliationCheck: new Date('2026-09-02T12:05:00.000Z'),
    affiliationResolutionState: 'resolved',
    managedCorporationId: 98_000_001,
    exceptionId: null,
    ...overrides,
  }
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
