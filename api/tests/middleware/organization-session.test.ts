import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  recompute: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: { select: vi.fn(() => query(mocks.selectResults.shift() ?? [])) },
}))
vi.mock('../../src/organization/compliance.js', () => ({
  recomputeOrganizationAccountCompliance: mocks.recompute,
}))

import { loadOrganizationSessionContext } from '../../src/middleware/organization-session.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'

describe('organization session context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectResults.length = 0
    mocks.recompute.mockResolvedValue({ outcome: 'unchanged' })
  })

  test('loads current compliance and block state without recomputation', async () => {
    const validUntil = new Date(Date.now() + 60_000)
    mocks.selectResults.push(
      [organizationRow({ accessValidUntil: validUntil })],
      [{ blockId: 'blocked-account' }],
    )

    await expect(loadOrganizationSessionContext(userId)).resolves.toEqual({
      organizationVersion: 7,
      state: 'compliant',
      evidenceFreshness: 'fresh',
      reviewDeadline: null,
      accessValidUntil: validUntil,
      blocked: true,
    })
    expect(mocks.recompute).not.toHaveBeenCalled()
  })

  test('refreshes expired compliant access before returning authorization state', async () => {
    const renewedUntil = new Date(Date.now() + 60_000)
    mocks.selectResults.push(
      [organizationRow({ accessValidUntil: new Date(0) })],
      [],
      [organizationRow({ state: 'suspended', accessValidUntil: renewedUntil })],
      [],
    )

    await expect(loadOrganizationSessionContext(userId)).resolves.toMatchObject({
      state: 'suspended',
      accessValidUntil: renewedUntil,
      blocked: false,
    })
    expect(mocks.recompute).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 1,
        organizationVersion: 7,
        userId,
        now: expect.any(Date),
      }),
    )
  })

  test('refreshes elapsed review deadlines and defaults missing projections', async () => {
    mocks.selectResults.push(
      [
        organizationRow({
          state: 'review_required',
          reviewDeadline: new Date(0),
          accessValidUntil: null,
        }),
      ],
      [],
      [
        {
          organizationVersion: 7,
          state: null,
          evidenceFreshness: null,
          reviewDeadline: null,
          accessValidUntil: null,
        },
      ],
      [],
    )

    await expect(loadOrganizationSessionContext(userId)).resolves.toEqual({
      organizationVersion: 7,
      state: 'pending',
      evidenceFreshness: 'unavailable',
      reviewDeadline: null,
      accessValidUntil: null,
      blocked: false,
    })
    expect(mocks.recompute).toHaveBeenCalledOnce()
  })

  test('refreshes review access that expires before its review deadline', async () => {
    const reviewDeadline = new Date(Date.now() + 60_000)
    mocks.selectResults.push(
      [
        organizationRow({
          state: 'review_required',
          reviewDeadline,
          accessValidUntil: new Date(0),
        }),
      ],
      [],
      [organizationRow({ state: 'suspended', reviewDeadline, accessValidUntil: null })],
      [],
    )

    await expect(loadOrganizationSessionContext(userId)).resolves.toMatchObject({
      state: 'suspended',
      accessValidUntil: null,
    })
    expect(mocks.recompute).toHaveBeenCalledOnce()
  })

  test('does not repeatedly refresh a suspended projection with an elapsed deadline', async () => {
    mocks.selectResults.push(
      [
        organizationRow({
          state: 'suspended',
          reviewDeadline: new Date(0),
          accessValidUntil: null,
        }),
      ],
      [],
    )

    await expect(loadOrganizationSessionContext(userId)).resolves.toMatchObject({
      state: 'suspended',
    })
    expect(mocks.recompute).not.toHaveBeenCalled()
  })

  test('creates a missing current-version projection before returning', async () => {
    const validUntil = new Date(Date.now() + 60_000)
    mocks.selectResults.push(
      [
        {
          organizationVersion: 7,
          projectedUserId: null,
          state: null,
          evidenceFreshness: null,
          reviewDeadline: null,
          accessValidUntil: null,
        },
      ],
      [],
      [organizationRow({ accessValidUntil: validUntil })],
      [],
    )

    await expect(loadOrganizationSessionContext(userId)).resolves.toMatchObject({
      state: 'compliant',
      accessValidUntil: validUntil,
    })
    expect(mocks.recompute).toHaveBeenCalledOnce()
  })

  test('requires a configured organization', async () => {
    mocks.selectResults.push([])

    await expect(loadOrganizationSessionContext(userId)).rejects.toThrow(
      'Deployment organization is not configured',
    )
  })
})

function organizationRow(
  overrides: Partial<{
    state: 'pending' | 'compliant' | 'review_required' | 'suspended'
    evidenceFreshness: 'fresh' | 'stale' | 'unavailable'
    reviewDeadline: Date | null
    accessValidUntil: Date | null
  }> = {},
) {
  return {
    organizationVersion: 7,
    projectedUserId: userId,
    state: 'compliant' as const,
    evidenceFreshness: 'fresh' as const,
    reviewDeadline: null,
    accessValidUntil: null,
    ...overrides,
  }
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'leftJoin', 'where']) builder[method] = () => builder
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
