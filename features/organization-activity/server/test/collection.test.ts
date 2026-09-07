import { describe, expect, test, vi } from 'vitest'
import type {
  PlatformResourceCollectionContext,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import { collectActivityResource } from '../src/collection.js'
import { materializeActivityResource } from '../src/collection-store.js'

const id = '11111111-1111-4111-8111-111111111111'
const now = '2026-09-07T10:00:00.000Z'
const summary = {
  id,
  name: 'Deliver supplies',
  state: 'Active',
  progress: { current: 1, desired: 10 },
}
function context(execute: ReturnType<typeof vi.fn>, checkpoint?: unknown) {
  const query = vi.fn().mockResolvedValue(checkpoint ? [{ checkpoint, revision: 3 }] : [])
  return {
    subject: { kind: 'character', characterId: 9001, lifecycleId: id },
    organizationVersion: 7,
    corporationId: 9801,
    authorizationGeneration: 4,
    requestBudget: 32,
    execute,
    capabilities: {
      persistence: { transaction: (fn: (tx: { query: typeof query }) => unknown) => fn({ query }) },
    },
  } as unknown as PlatformResourceCollectionContext<PlatformResourceSubject>
}

describe('activity collection', () => {
  test('resumes a bounded exact-character contribution without losing its before cursor', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      data: { projects: [summary], cursor: { before: 'older', after: 'initial' } },
      validatedAt: now,
    })
    const first = await collectActivityResource(
      { id: 'character-projects', rootOperation: 'project-list', paginated: true },
      { ...context(execute), requestBudget: 1 },
    )
    expect(first.complete).toBe(false)
    expect(first.data.checkpoint.requests[0]?.path).toEqual({
      character_id: 9001,
      corporation_id: 9801,
      project_id: id,
    })
    const resumed = vi
      .fn()
      .mockResolvedValueOnce({ data: { contributed: 3 }, validatedAt: now })
      .mockResolvedValueOnce({ data: { projects: [], cursor: {} }, validatedAt: now })
    const last = await collectActivityResource(
      { id: 'character-projects', rootOperation: 'project-list', paginated: true },
      context(resumed, first.data.checkpoint),
    )
    expect(last.complete).toBe(true)
    expect(last.data.expectedRevision).toBe(3)
    expect(last.data.checkpoint.cursors.root).toEqual({ after: 'initial' })
    expect(last.data.snapshots[0]).toMatchObject({
      replace: false,
      snapshot: { id, contributed: 3 },
    })
    expect(resumed.mock.calls[1]?.[1].query).toEqual({ limit: 100, before: 'older' })
  })

  test('retains a complete character job membership list including an empty replacement', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ data: { freelance_jobs: [summary] }, validatedAt: now })
      .mockResolvedValueOnce({ data: { contributed: 2, state: 'Committed' }, validatedAt: now })
    const profile = { id: 'character-jobs', rootOperation: 'character-jobs', paginated: false }
    const result = await collectActivityResource(profile, context(execute))
    expect(result.data.checkpoint.retainedIds).toEqual([id])
    expect(result.data.snapshots[0]?.snapshot).toMatchObject({ contributed: 2, committed: true })
    const empty = await collectActivityResource(
      profile,
      context(
        vi.fn().mockResolvedValue({ data: { freelance_jobs: [] }, validatedAt: now }),
        result.data.checkpoint,
      ),
    )
    expect(empty.data.checkpoint.retainedIds).toEqual([])
  })

  test('replaces incremental observations and rejects broken cursor progress', async () => {
    const profile = { id: 'corporation-jobs', rootOperation: 'corporation-jobs', paginated: true }
    const checkpoint = { initialized: true, requests: [], cursors: { root: { after: 'old' } } }
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        data: { freelance_jobs: [summary], cursor: { after: 'new' } },
        validatedAt: now,
      })
      .mockResolvedValueOnce({ data: { freelance_jobs: [] }, validatedAt: now })
    const result = await collectActivityResource(profile, context(execute, checkpoint))
    expect(result.data.snapshots[0]?.replace).toBe(true)
    await expect(
      collectActivityResource(
        profile,
        context(
          vi.fn().mockResolvedValue({
            data: { freelance_jobs: [summary], cursor: { after: 'old' } },
            validatedAt: now,
          }),
          checkpoint,
        ),
      ),
    ).rejects.toThrow('cursor did not advance')
  })

  test('does not commit a partial result when a dependent request fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        data: { campaigns: [{ id, state: 'Active', progress: 0 }] },
        validatedAt: now,
      })
      .mockRejectedValueOnce(new Error('cooldown'))
    await expect(
      collectActivityResource(
        { id: 'campaigns', rootOperation: 'campaign-list', paginated: false },
        context(execute),
      ),
    ).rejects.toThrow('cooldown')
  })

  test('rejects obsolete checkpoint writers before touching snapshots', async () => {
    const query = vi.fn().mockResolvedValue([{ revision: 5 }])
    const result = await materializeActivityResource({
      subject: { lifecycleId: id },
      authorizationGeneration: 4,
      data: { resourceId: 'character-jobs', organizationVersion: 7, expectedRevision: 3 },
      capabilities: {
        persistence: {
          transaction: (fn: (tx: { query: typeof query }) => unknown) => fn({ query }),
        },
      },
    } as never)
    expect(result).toEqual({ outcome: 'obsolete' })
    expect(query).toHaveBeenCalledTimes(1)
  })

  test('writes snapshots, revision and membership pruning in the provided transaction', async () => {
    const query = vi.fn().mockResolvedValue([])
    const collect = await collectActivityResource(
      { id: 'character-jobs', rootOperation: 'character-jobs', paginated: false },
      context(vi.fn().mockResolvedValue({ data: { freelance_jobs: [] }, validatedAt: now })),
    )
    await materializeActivityResource({
      subject: { lifecycleId: id },
      authorizationGeneration: 4,
      validatedAt: now,
      data: collect.data,
      capabilities: {
        persistence: {
          transaction: (fn: (tx: { query: typeof query }) => unknown) => fn({ query }),
        },
      },
    } as never)
    expect(query.mock.calls.find(([sql]) => sql.includes('not (activity_id'))?.[1]).toEqual([
      'character-jobs',
      id,
      7,
      4,
      [],
    ])
    expect(
      query.mock.calls
        .find(([sql]) => sql.includes('insert into collection_checkpoints'))?.[1]
        .at(-1),
    ).toBe(1)
  })
})
