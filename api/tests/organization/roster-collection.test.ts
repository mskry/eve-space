import { describe, expect, test } from 'vitest'
import { materializeCorporationRoster } from '../../src/organization/roster-collection.js'
import { corporationMembershipScope } from '../../src/organization/corporation-membership.js'

const input = {
  characterId: 1_404_328_063,
  characterIds: [1_404_328_063, 1_404_328_064],
  corporationId: 98_000_001,
  organizationVersion: 4,
  sourceId: '98a782d2-e042-47d7-9659-03b218121a1a',
  tokenVersion: 7,
  validatedAt: new Date('2026-09-01T12:00:00.000Z'),
}

describe('corporation roster materialization', () => {
  test('replaces a current source snapshot atomically', async () => {
    const current = transaction([
      {
        affiliationCheckedAt: new Date('2099-09-01T11:00:00.000Z'),
        affiliationResolutionState: 'resolved',
        characterId: input.characterId,
        corporationId: input.corporationId,
        currentSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        nextAffiliationCheck: new Date('2099-09-01T12:00:00.000Z'),
        scopes: [corporationMembershipScope],
        sourceAuthorizationGeneration: input.tokenVersion,
        sourceFreshUntil: new Date('2099-09-01T13:00:00.000Z'),
        sourceGraceUntil: null,
        sourceId: input.sourceId,
        sourceInvalidatedAt: null,
        sourceStatus: 'fresh',
        sourceSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        tokenVersion: input.tokenVersion,
      },
    ])

    await expect(materializeCorporationRoster(current.database, input)).resolves.toStrictEqual({
      characterIds: input.characterIds,
      outcome: 'refreshed',
    })
    expect(current.deletes).toBe(1)
    expect(current.inserts).toStrictEqual([
      input.characterIds.map((characterId) =>
        expect.objectContaining({
          authorizationGeneration: input.tokenVersion,
          characterId,
          corporationId: input.corporationId,
          sourceId: input.sourceId,
        }),
      ),
    ])
  })

  test('rejects obsolete source and authorization generations without changing observations', async () => {
    const obsolete = transaction([])
    await expect(materializeCorporationRoster(obsolete.database, input)).resolves.toStrictEqual({
      outcome: 'obsolete',
    })
    expect(obsolete.deletes).toBe(0)
    expect(obsolete.inserts).toHaveLength(0)
  })

  test('rejects a source whose affiliation evidence has expired', async () => {
    const stale = transaction([
      {
        affiliationCheckedAt: new Date('2026-09-01T11:00:00.000Z'),
        affiliationResolutionState: 'resolved',
        characterId: input.characterId,
        corporationId: input.corporationId,
        currentSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        nextAffiliationCheck: new Date(0),
        scopes: [corporationMembershipScope],
        sourceAuthorizationGeneration: input.tokenVersion,
        sourceFreshUntil: new Date('2099-09-01T13:00:00.000Z'),
        sourceGraceUntil: null,
        sourceId: input.sourceId,
        sourceInvalidatedAt: null,
        sourceStatus: 'fresh',
        sourceSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        tokenVersion: input.tokenVersion,
      },
    ])

    await expect(materializeCorporationRoster(stale.database, input)).resolves.toStrictEqual({
      outcome: 'obsolete',
    })
    expect(stale.deletes).toBe(0)
    expect(stale.inserts).toHaveLength(0)
  })

  test('rejects resolved affiliation without checked evidence', async () => {
    const unavailable = transaction([
      {
        affiliationCheckedAt: null,
        affiliationResolutionState: 'resolved',
        characterId: input.characterId,
        corporationId: input.corporationId,
        currentSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        nextAffiliationCheck: new Date('2099-09-01T12:00:00.000Z'),
        scopes: [corporationMembershipScope],
        sourceAuthorizationGeneration: input.tokenVersion,
        sourceFreshUntil: new Date('2099-09-01T13:00:00.000Z'),
        sourceGraceUntil: null,
        sourceId: input.sourceId,
        sourceInvalidatedAt: null,
        sourceStatus: 'fresh',
        sourceSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        tokenVersion: input.tokenVersion,
      },
    ])

    await expect(materializeCorporationRoster(unavailable.database, input)).resolves.toStrictEqual({
      outcome: 'obsolete',
    })
    expect(unavailable.deletes).toBe(0)
    expect(unavailable.inserts).toHaveLength(0)
  })
})

function transaction(source: unknown[]) {
  const inserts: unknown[] = []
  let deletes = 0
  const state = {
    database: {
      select() {
        return query(source)
      },
      delete() {
        deletes += 1
        return query([])
      },
      insert() {
        return query([], (value) => inserts.push(value))
      },
    } as never,
    get deletes() {
      return deletes
    },
    inserts,
  }
  return state
}

function query(result: unknown[], record?: (value: unknown) => void) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'for']) {
    builder[method] = () => builder
  }
  builder.values = (value: unknown) => {
    record?.(value)
    return builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
