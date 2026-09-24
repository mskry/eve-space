import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ appendEvent: vi.fn() }))

vi.mock('../../src/domain-events/store.js', () => ({ appendDomainEvent: mocks.appendEvent }))

import {
  initializeManagedOrganization,
  materializeManagedAllianceCorporations,
} from '../../src/organization/managed-corporations.js'

const observedAt = new Date('2026-09-01T12:00:00.000Z')

describe('managed corporation materialization', () => {
  beforeEach(() => mocks.appendEvent.mockReset().mockResolvedValue(undefined))

  test('initializes the correct generic subject for corporation and alliance deployments', async () => {
    const alliance = transaction()
    await initializeManagedOrganization(
      alliance.database,
      {
        deploymentId: 1,
        organizationId: 99_000_001,
        organizationType: 'alliance',
        organizationVersion: 4,
      },
      observedAt,
    )
    expect(alliance.inserts).toStrictEqual([
      expect.objectContaining({
        organizationVersion: 4,
        subjectId: '1',
        subjectKind: 'deployment',
      }),
      expect.objectContaining({
        organizationVersion: 4,
        subjectId: '99000001',
        subjectKind: 'alliance',
      }),
    ])
    expect(mocks.appendEvent).not.toHaveBeenCalled()

    const corporation = transaction()
    await initializeManagedOrganization(
      corporation.database,
      {
        deploymentId: 1,
        organizationId: 98_000_001,
        organizationType: 'corporation',
        organizationVersion: 4,
      },
      observedAt,
    )
    expect(corporation.inserts).toStrictEqual([
      expect.objectContaining({
        organizationVersion: 4,
        subjectId: '1',
        subjectKind: 'deployment',
      }),
      expect.objectContaining({ corporationId: 98_000_001, organizationVersion: 4 }),
    ])
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: { corporationId: 98_000_001, deploymentId: 1, organizationVersion: 4 },
        type: 'organization.managed-corporation-added',
      }),
    )
  })

  test('converges additions and departures from the current alliance snapshot', async () => {
    const current = transaction([
      [{ id: 1 }],
      [
        { corporationId: 98_000_001, isCurrent: true },
        { corporationId: 98_000_002, isCurrent: true },
        { corporationId: 98_000_004, isCurrent: false },
      ],
    ])
    await expect(
      materializeManagedAllianceCorporations(current.database, {
        allianceId: 99_000_001,
        corporationIds: [98_000_002, 98_000_003],
        organizationVersion: 4,
        validatedAt: observedAt,
      }),
    ).resolves.toStrictEqual({
      addedIds: [98_000_003],
      corporationIds: [98_000_002, 98_000_003],
      outcome: 'refreshed',
      removedIds: [98_000_001],
    })
    expect(current.inserts).toHaveLength(1)
    expect(current.updates).toHaveLength(1)
    expect(mocks.appendEvent).toHaveBeenCalledTimes(2)
    expect(mocks.appendEvent).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ type: 'organization.managed-corporation-added' }),
    )
    expect(mocks.appendEvent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ type: 'organization.managed-corporation-removed' }),
    )
  })

  test('does not materialize an obsolete organization epoch', async () => {
    const obsolete = transaction([[]])
    await expect(
      materializeManagedAllianceCorporations(obsolete.database, {
        allianceId: 99_000_001,
        corporationIds: [98_000_001],
        organizationVersion: 3,
        validatedAt: observedAt,
      }),
    ).resolves.toStrictEqual({ outcome: 'obsolete' })
    expect(obsolete.inserts).toHaveLength(0)
    expect(mocks.appendEvent).not.toHaveBeenCalled()
  })
})

function transaction(selectResults: unknown[][] = []) {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  return {
    database: {
      select() {
        return query(selectResults.shift() ?? [])
      },
      insert() {
        return query([], (value) => inserts.push(value))
      },
      update() {
        return query([], (value) => updates.push(value))
      },
    } as never,
    inserts,
    updates,
  }
}

function query(result: unknown[], record?: (value: unknown) => void) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'for', 'onConflictDoUpdate']) {
    builder[method] = () => builder
  }
  for (const method of ['values', 'set']) {
    builder[method] = (value: unknown) => {
      record?.(value)
      return builder
    }
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
