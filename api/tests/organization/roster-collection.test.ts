import { describe, expect, test } from 'vitest'
import { materializeCorporationRoster } from '../../src/organization/roster-collection.js'
import { corporationMembershipScope } from '../../src/organization/corporation-sources.js'

const input = {
  organizationVersion: 4,
  corporationId: 98000001,
  sourceId: '98a782d2-e042-47d7-9659-03b218121a1a',
  characterId: 1404328063,
  tokenVersion: 7,
  characterIds: [1404328063, 1404328064],
  validatedAt: new Date('2026-09-01T12:00:00.000Z'),
}

describe('corporation roster materialization', () => {
  test('replaces a current source snapshot atomically', async () => {
    const current = transaction([
      {
        sourceId: input.sourceId,
        characterId: input.characterId,
        corporationId: input.corporationId,
        affiliationResolutionState: 'resolved',
        tokenVersion: input.tokenVersion,
        scopes: [corporationMembershipScope],
      },
    ])

    await expect(materializeCorporationRoster(current.database, input)).resolves.toEqual({
      outcome: 'refreshed',
      characterIds: input.characterIds,
    })
    expect(current.deletes).toBe(1)
    expect(current.inserts).toEqual([
      input.characterIds.map((characterId) =>
        expect.objectContaining({
          corporationId: input.corporationId,
          characterId,
          sourceId: input.sourceId,
        }),
      ),
    ])
  })

  test('rejects obsolete source and authorization generations without changing observations', async () => {
    const obsolete = transaction([])
    await expect(materializeCorporationRoster(obsolete.database, input)).resolves.toEqual({
      outcome: 'obsolete',
    })
    expect(obsolete.deletes).toBe(0)
    expect(obsolete.inserts).toHaveLength(0)
  })
})

function transaction(source: unknown[]) {
  const inserts: unknown[] = []
  let deletes = 0
  const state = {
    inserts,
    get deletes() {
      return deletes
    },
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
  }
  return state
}

function query(result: unknown[], record?: (value: unknown) => void) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'for']) builder[method] = () => builder
  builder.values = (value: unknown) => {
    record?.(value)
    return builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
