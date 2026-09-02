import { describe, expect, test, vi } from 'vitest'
import {
  hasCurrentComplianceAccess,
  isComplianceProjectionDue,
} from '../../src/organization/compliance-access.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'

describe('organization compliance access locking', () => {
  test.each([
    {
      state: 'review_required' as const,
      reviewDeadline: new Date('2026-09-01T13:00:00Z'),
      accessValidUntil: null,
      expected: false,
    },
    {
      state: 'review_required' as const,
      reviewDeadline: new Date('2026-09-01T13:00:00Z'),
      accessValidUntil: new Date('2026-09-01T11:00:00Z'),
      expected: true,
    },
    {
      state: 'suspended' as const,
      reviewDeadline: new Date('2026-09-01T11:00:00Z'),
      accessValidUntil: null,
      expected: false,
    },
  ])('classifies projection convergence as $expected', ({ expected, ...projection }) => {
    expect(isComplianceProjectionDue(projection, new Date('2026-09-01T12:00:00Z'))).toBe(expected)
  })

  test.each([
    { rows: [{ userId, state: 'compliant', reviewDeadline: null }], expected: true },
    { rows: [], expected: false },
  ])('returns $expected from the locked current projection', async ({ rows, expected }) => {
    const forLock = vi.fn<(lock: string) => void>()
    const database = {
      select: vi.fn(() => query(rows, forLock)),
    }

    await expect(
      hasCurrentComplianceAccess(database as never, 4, userId, new Date('2026-09-01T12:00:00Z')),
    ).resolves.toBe(expected)
    expect(forLock).toHaveBeenCalledWith('update')
  })
})

function query(result: unknown[], forLock: (lock: string) => void) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where']) builder[method] = () => builder
  builder.for = (lock: string) => {
    forLock(lock)
    return builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
