import { describe, expect, test, vi } from 'vitest'
import { collectActivityResource } from '../src/collection.js'
import {
  materializeActivityResource,
  type ActivityCollectionContext,
} from '../src/collection-store.js'
import { summarySnapshot } from '../src/snapshot.js'

const id = '11111111-1111-4111-8111-111111111111'
const now = '2026-09-07T10:00:00.000Z'
const summary = {
  id,
  name: 'Deliver supplies',
  progress: { current: 1, desired: 10 },
  state: 'Active',
}
const unavailableItem = { code: 'ESI_HTTP_ERROR', status: 404 }
function context(execute: ReturnType<typeof vi.fn>, checkpoint?: unknown) {
  const readActivityCheckpoint = vi
    .fn()
    .mockResolvedValue(checkpoint ? { checkpoint, revision: 3 } : null)
  return {
    authorizationGeneration: 4,
    capabilities: {
      persistence: { readActivityCheckpoint },
    },
    corporationId: 9801,
    operations: new Proxy(
      {},
      { get: (_target, operationId) => (inputs: unknown) => execute(operationId, inputs) },
    ),
    organizationVersion: 7,
    requestBudget: 32,
    subject: { characterId: 9001, kind: 'character', lifecycleId: id },
  } as unknown as ActivityCollectionContext
}

describe('activity collection', () => {
  test('resumes a bounded exact-character contribution without losing its before cursor', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      data: { cursor: { after: 'initial', before: 'older' }, projects: [summary] },
      validatedAt: now,
    })
    const first = await collectActivityResource(
      { id: 'character-projects', paginated: true, rootOperation: 'project-list' },
      { ...context(execute), requestBudget: 1 },
    )
    expect(first.complete).toBe(false)
    expect(first.data.checkpoint.requests[0]?.path).toStrictEqual({
      character_id: 9001,
      corporation_id: 9801,
      project_id: id,
    })
    const resumed = vi
      .fn()
      .mockResolvedValueOnce({ data: { contributed: 3 }, validatedAt: now })
      .mockResolvedValueOnce({ data: { cursor: {}, projects: [] }, validatedAt: now })
    const last = await collectActivityResource(
      { id: 'character-projects', paginated: true, rootOperation: 'project-list' },
      context(resumed, first.data.checkpoint),
    )
    expect(last.complete).toBe(true)
    expect(last.data.expectedRevision).toBe(3)
    expect(last.data.checkpoint.cursors.root).toStrictEqual({ after: 'initial' })
    expect(last.data.snapshots[0]).toMatchObject({
      replace: false,
      snapshot: { contributed: 3, id },
    })
    expect(resumed.mock.calls[1]?.[1].query).toStrictEqual({ before: 'older', limit: 100 })
  })

  test('retains a complete character job membership list including an empty replacement', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ data: { freelance_jobs: [summary] }, validatedAt: now })
      .mockResolvedValueOnce({ data: { contributed: 2, state: 'Committed' }, validatedAt: now })
    const profile = { id: 'character-jobs', paginated: false, rootOperation: 'character-jobs' }
    const result = await collectActivityResource(profile, context(execute))
    expect(result.data.checkpoint.retainedIds).toStrictEqual([id])
    expect(result.data.snapshots[0]?.snapshot).toMatchObject({ committed: true, contributed: 2 })
    const empty = await collectActivityResource(
      profile,
      context(
        vi.fn().mockResolvedValue({ data: { freelance_jobs: [] }, validatedAt: now }),
        result.data.checkpoint,
      ),
    )
    expect(empty.data.checkpoint.retainedIds).toStrictEqual([])
  })

  test('replaces incremental observations and rejects broken cursor progress', async () => {
    const profile = { id: 'corporation-jobs', paginated: true, rootOperation: 'corporation-jobs' }
    const corporationContext = (execute: ReturnType<typeof vi.fn>, stored?: unknown) => ({
      ...context(execute, stored),
      subject: { corporationId: 9801, kind: 'corporation' as const, lifecycleId: id },
    })
    const checkpoint = { cursors: { root: { after: 'old' } }, initialized: true, requests: [] }
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        data: { cursor: { after: 'new' }, freelance_jobs: [summary] },
        validatedAt: now,
      })
      .mockResolvedValueOnce({ data: { freelance_jobs: [] }, validatedAt: now })
    const result = await collectActivityResource(profile, corporationContext(execute, checkpoint))
    expect(result.data.snapshots[0]?.replace).toBe(true)
    await expect(
      collectActivityResource(
        profile,
        corporationContext(
          vi.fn().mockResolvedValue({
            data: { cursor: { after: 'old' }, freelance_jobs: [summary] },
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
        data: { campaigns: [{ id, progress: 0, state: 'Active' }] },
        validatedAt: now,
      })
      .mockRejectedValueOnce(new Error('cooldown'))
    await expect(
      collectActivityResource(
        { id: 'campaigns', paginated: false, rootOperation: 'campaign-list' },
        context(execute),
      ),
    ).rejects.toThrow('cooldown')
  })

  test.each([
    ['campaign-detail', { campaign_id: id }, undefined],
    ['objective-list', { campaign_id: id }, undefined],
    ['objective-detail', { campaign_id: id, objective_id: id }, undefined],
    [
      'project-detail',
      { corporation_id: 9801, project_id: id },
      summarySnapshot(summary, 'project', 9801),
    ],
  ])('recovers when a listed item disappears before %s', async (operation, path, snapshot) => {
    const execute = vi.fn().mockRejectedValue(unavailableItem)
    const result = await collectActivityResource(
      { id: 'campaigns', paginated: false, rootOperation: 'campaign-list' },
      context(execute, {
        cursors: {},
        initialized: true,
        requests: [{ operation, path, replace: true, snapshot, validatedAt: now }],
      }),
    )
    expect(result.complete).toBe(true)
    expect(result.data.snapshots).toStrictEqual(
      snapshot ? [{ replace: true, snapshot, validatedAt: now }] : [],
    )
  })

  test('does not recover an unavailable root collection request', async () => {
    await expect(
      collectActivityResource(
        { id: 'campaigns', paginated: false, rootOperation: 'campaign-list' },
        context(vi.fn().mockRejectedValue(unavailableItem)),
      ),
    ).rejects.toBe(unavailableItem)
  })

  test('retains objective parents only while campaigns are active', async () => {
    const inactiveId = '22222222-2222-4222-8222-222222222222'
    const result = await collectActivityResource(
      { id: 'campaigns', paginated: false, rootOperation: 'campaign-list' },
      {
        ...context(
          vi.fn().mockResolvedValue({
            data: {
              campaigns: [
                { id, progress: 0, state: 'Active' },
                { id: inactiveId, progress: 1, state: 'Completed' },
              ],
            },
            validatedAt: now,
          }),
        ),
        requestBudget: 1,
      },
    )
    expect(result.data.checkpoint.retainedIds).toStrictEqual([id, inactiveId])
    expect(result.data.checkpoint.retainedCampaignIds).toStrictEqual([id])
  })

  test('rejects obsolete checkpoint writers before touching snapshots', async () => {
    const materializeActivityObservation = vi
      .fn()
      .mockResolvedValue({ outcome: 'obsolete' as const })
    const result = await materializeActivityResource({
      authorizationGeneration: 4,
      capabilities: { persistence: { materializeActivityObservation } },
      data: {
        checkpoint: { cursors: {}, initialized: true, requests: [] },
        expectedRevision: 3,
        organizationVersion: 7,
        resourceId: 'character-jobs',
        snapshots: [],
      },
      subject: { lifecycleId: id },
    } as never)
    expect(result).toStrictEqual({ outcome: 'obsolete' })
    expect(materializeActivityObservation).toHaveBeenCalledOnce()
  })

  test('submits snapshots, revision and membership pruning through one generated operation', async () => {
    const materializeActivityObservation = vi
      .fn()
      .mockResolvedValue({ outcome: 'applied' as const, revision: 1 })
    const collect = await collectActivityResource(
      { id: 'character-jobs', paginated: false, rootOperation: 'character-jobs' },
      context(vi.fn().mockResolvedValue({ data: { freelance_jobs: [] }, validatedAt: now })),
    )
    await materializeActivityResource({
      authorizationGeneration: 4,
      capabilities: { persistence: { materializeActivityObservation } },
      data: collect.data,
      subject: { lifecycleId: id },
      validatedAt: now,
    } as never)
    expect(materializeActivityObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationGeneration: 4,
        checkpoint: expect.objectContaining({ retainedIds: [], retainedCampaignIds: undefined }),
        expectedRevision: 0,
        organizationVersion: 7,
        resourceId: 'character-jobs',
        snapshots: [],
        subjectLifecycleId: id,
      }),
    )
    expect(materializeActivityObservation.mock.calls[0]?.[0].materializationId).toMatch(
      /^[0-9a-f-]{36}$/,
    )
  })

  test('does not renew snapshots absent from an incremental response', async () => {
    const materializeActivityObservation = vi
      .fn()
      .mockResolvedValue({ outcome: 'applied' as const, revision: 1 })
    await materializeActivityResource({
      authorizationGeneration: 4,
      capabilities: { persistence: { materializeActivityObservation } },
      data: {
        checkpoint: { cursors: { root: { after: 'next' } }, initialized: true, requests: [] },
        expectedRevision: 0,
        organizationVersion: 7,
        resourceId: 'corporation-jobs',
        snapshots: [],
      },
      subject: { lifecycleId: id },
      validatedAt: now,
    } as never)
    expect(materializeActivityObservation).toHaveBeenCalledWith(
      expect.objectContaining({ snapshots: [] }),
    )
  })
})
