import { describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { readActivitySnapshots } from '../src/snapshot-reads.js'
import { activityRoutes, participationRoutes } from '../src/routes.js'

const id = '11111111-1111-4111-8111-111111111111'
const snapshot = { id, campaignId: null, contributed: 12, committed: true }
function capabilities(status = 'current', failure: string | null = null) {
  const query = vi.fn().mockResolvedValue([{ snapshot }])
  const read = vi.fn().mockResolvedValue({
    status,
    subjectLifecycleId: id,
    authorizationGeneration: 9,
    validatedAt: '2026-09-07T10:00:00Z',
    lastFailureClass: failure,
  })
  return {
    query,
    read,
    persistence: { transaction: (fn: (tx: { query: typeof query }) => unknown) => fn({ query }) },
    collectionStatus: { read },
  }
}

describe('authorized snapshot reads', () => {
  test('binds detail reads to epoch, lifecycle, generation and exact activity', async () => {
    const cap = capabilities()
    const result = await readActivitySnapshots(
      cap as never,
      7,
      'character-jobs',
      { kind: 'character', characterId: 9001 },
      id,
    )
    expect(result.snapshots).toEqual([snapshot])
    expect(cap.query.mock.calls[0]?.[1]).toEqual(['character-jobs', id, 7, 9, id])
  })
  test.each([
    'never-configured',
    'never-collected',
    'authorization-required',
    'unavailable',
    'stale',
  ])('does not read private storage for %s', async (status) => {
    const cap = capabilities(status)
    expect(
      (
        await readActivitySnapshots(cap as never, 7, 'character-projects', {
          kind: 'character',
          characterId: 9001,
        })
      ).snapshots,
    ).toEqual([])
    expect(cap.query).not.toHaveBeenCalled()
  })
  test.each(['esi-unavailable', 'esi-cooldown'])(
    'permits bounded private outage fallback for %s',
    async (failure) => {
      const cap = capabilities('stale', failure)
      expect(
        (
          await readActivitySnapshots(cap as never, 7, 'corporation-projects', {
            kind: 'corporation',
            corporationId: 9801,
          })
        ).snapshots,
      ).toEqual([snapshot])
      expect(cap.query.mock.calls[0]?.[0]).toContain("interval '1 hour'")
    },
  )
  test('does not release stale private snapshots on invalid upstream data or unauthorized subjects', async () => {
    const cap = capabilities('stale', 'response-invalid')
    await readActivitySnapshots(cap as never, 7, 'character-jobs', {
      kind: 'character',
      characterId: 9002,
    })
    cap.read.mockRejectedValueOnce(new Error('outside context'))
    const denied = await readActivitySnapshots(cap as never, 7, 'character-jobs', {
      kind: 'character',
      characterId: 9002,
    })
    expect(denied.status.status).toBe('unavailable')
    expect(cap.query).not.toHaveBeenCalled()
  })
  test('public stale sources retain their safe snapshots', async () => {
    const cap = capabilities('stale')
    expect(
      (
        await readActivitySnapshots(cap as never, 7, 'public-jobs', {
          kind: 'deployment',
          deploymentId: 1,
        })
      ).snapshots,
    ).toEqual([snapshot])
  })
})

describe('activity routes behind host authorization', () => {
  function app() {
    const cap = capabilities()
    const server = new Hono()
      .use('*', (c, next) => {
        c.set(
          'platform' as never,
          {
            organization: { organizationVersion: 7 },
            authorization: { characterId: 9001 },
            collectionStatus: cap.collectionStatus,
          } as never,
        )
        return next()
      })
      .route('/details', activityRoutes(cap as never))
      .route('/participation', participationRoutes(cap as never))
    return { cap, server }
  }
  test('validates UUID and project corporation before storage', async () => {
    const { cap, server } = app()
    expect((await server.request('/details/job/bad')).status).toBe(400)
    expect((await server.request(`/details/project/${id}`)).status).toBe(400)
    expect((await server.request(`/details/project/${id}?corporationId=-1`)).status).toBe(400)
    expect(cap.query).not.toHaveBeenCalled()
  })
  test('uses only the host-owned character and strips private snapshot fields', async () => {
    const { cap, server } = app()
    const response = await server.request(`/participation/job/${id}?characterId=9002`)
    expect(await response.json()).toMatchObject({
      characterId: 9001,
      participation: [{ activityId: id, contributed: 12, committed: true }],
    })
    expect(cap.read).toHaveBeenCalledWith('character-jobs', {
      kind: 'character',
      characterId: 9001,
    })
  })
  test('resolves a character-only job exclusively through the owned route', async () => {
    const { cap, server } = app()
    cap.query.mockImplementation(async (_sql, parameters) =>
      parameters[0] === 'character-jobs' ? [{ snapshot }] : [],
    )
    expect(await (await server.request(`/details/job/${id}`)).json()).toMatchObject({
      activity: null,
    })
    expect(await (await server.request(`/participation/job/${id}`)).json()).toMatchObject({
      characterId: 9001,
      activity: { id },
    })
    cap.read.mockResolvedValue({
      status: 'authorization-required',
      authorizationGeneration: null,
      validatedAt: null,
    })
    expect(await (await server.request(`/participation/job/${id}`)).json()).toMatchObject({
      activity: null,
      participation: [],
    })
  })

  test.each(['project', 'job', 'campaign'])(
    'returns exact %s details with current organization identity',
    async (kind) => {
      const { server } = app()
      const response = await server.request(`/details/${kind}/${id}?corporationId=9801`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ organizationVersion: 7, activity: { id } })
    },
  )
})
