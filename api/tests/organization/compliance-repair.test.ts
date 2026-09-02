import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  expireExceptions: vi.fn(),
  recompute: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(() => query(mocks.selectResults.shift() ?? [])),
  },
}))
vi.mock('../../src/organization/compliance.js', () => ({
  recomputeOrganizationAccountCompliance: mocks.recompute,
}))
vi.mock('../../src/organization/exception-store.js', () => ({
  expireOrganizationCharacterExceptions: mocks.expireExceptions,
}))

import { repairOrganizationCompliance } from '../../src/organization/compliance-repair.js'

const now = new Date('2026-09-01T12:00:00.000Z')

describe('organization compliance repair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectResults.length = 0
    mocks.expireExceptions.mockResolvedValue([])
    mocks.recompute.mockResolvedValue({ outcome: 'unchanged' })
  })

  test('returns cleanly before exception expiry when no organization is configured', async () => {
    mocks.selectResults.push([])

    await expect(repairOrganizationCompliance({ now })).resolves.toEqual({ repaired: 0 })
    expect(mocks.expireExceptions).not.toHaveBeenCalled()
    expect(mocks.recompute).not.toHaveBeenCalled()
  })

  test('repairs missing, expired, and oldest projections in one bounded pass', async () => {
    mocks.selectResults.push(
      [{ organizationVersion: 4 }],
      [{ userId: '00000000-0000-4000-8000-000000000001' }],
      [],
      [{ userId: '00000000-0000-4000-8000-000000000002' }],
      [{ userId: '00000000-0000-4000-8000-000000000003' }],
    )

    await expect(repairOrganizationCompliance({ now, limit: 3 })).resolves.toEqual({ repaired: 3 })
    expect(mocks.expireExceptions).toHaveBeenCalledWith(now, 3)
    expect(mocks.recompute).toHaveBeenCalledTimes(3)
  })

  test('continues the batch after one account fails and reports the aggregate failure', async () => {
    mocks.selectResults.push(
      [{ organizationVersion: 4 }],
      [
        { userId: '00000000-0000-4000-8000-000000000001' },
        { userId: '00000000-0000-4000-8000-000000000002' },
      ],
      [],
    )
    mocks.recompute
      .mockRejectedValueOnce(new Error('invalid account state'))
      .mockResolvedValueOnce({ outcome: 'unchanged' })

    await expect(repairOrganizationCompliance({ now, limit: 2 })).rejects.toThrow(
      'Failed to repair 1 compliance projection(s)',
    )
    expect(mocks.recompute).toHaveBeenCalledTimes(2)
  })
})

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'orderBy', 'limit']) builder[method] = () => builder
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
