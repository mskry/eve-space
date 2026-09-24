import { describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { readActivitySnapshots } from '../src/snapshot-reads.js'
import { activityRoutes, participationRoutes } from '../src/routes.js'

const id = '11111111-1111-4111-8111-111111111111'
const snapshot = { campaignId: null, committed: true, contributed: 12, id }
function capabilities(status = 'current', failure: string | null = null) {
  const readSnapshots = vi.fn().mockResolvedValue([snapshot])
  const read = vi.fn().mockResolvedValue({
    authorizationGeneration: 9,
    lastFailureClass: failure,
    status,
    subjectLifecycleId: id,
    validatedAt: '2026-09-07T10:00:00Z',
  })
  return {
    collectionStatus: { read },
    persistence: { readActivitySnapshots: readSnapshots },
    read,
    readActivitySnapshots: readSnapshots,
  }
}

describe('authorized snapshot reads', () => {
  test('binds detail reads to epoch, lifecycle, generation and exact activity', async () => {
    const cap = capabilities()
    const result = await readActivitySnapshots(
      cap as never,
      7,
      'character-jobs',
      { characterId: 9001, kind: 'character' },
      id,
    )
    expect(result.snapshots).toStrictEqual([snapshot])
    expect(cap.readActivitySnapshots).toHaveBeenCalledWith({
      activityId: id,
      authorizationGeneration: 9,
      organizationVersion: 7,
      resourceId: 'character-jobs',
      subjectLifecycleId: id,
    })
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
          characterId: 9001,
          kind: 'character',
        })
      ).snapshots,
    ).toStrictEqual([])
    expect(cap.readActivitySnapshots).not.toHaveBeenCalled()
  })
  test.each(['esi-unavailable', 'esi-cooldown'])(
    'permits bounded private outage fallback for %s',
    async (failure) => {
      const cap = capabilities('stale', failure)
      expect(
        (
          await readActivitySnapshots(cap as never, 7, 'corporation-projects', {
            corporationId: 9801,
            kind: 'corporation',
          })
        ).snapshots,
      ).toStrictEqual([snapshot])
      expect(cap.readActivitySnapshots).toHaveBeenCalledOnce()
    },
  )
  test('does not release stale private snapshots on invalid upstream data or unauthorized subjects', async () => {
    const cap = capabilities('stale', 'response-invalid')
    await readActivitySnapshots(cap as never, 7, 'character-jobs', {
      characterId: 9002,
      kind: 'character',
    })
    cap.read.mockRejectedValueOnce(new Error('outside context'))
    const denied = await readActivitySnapshots(cap as never, 7, 'character-jobs', {
      characterId: 9002,
      kind: 'character',
    })
    expect(denied.status.status).toBe('unavailable')
    expect(cap.readActivitySnapshots).not.toHaveBeenCalled()
  })
  test('public stale sources retain their safe snapshots', async () => {
    const cap = capabilities('stale')
    expect(
      (
        await readActivitySnapshots(cap as never, 7, 'public-jobs', {
          deploymentId: 1,
          kind: 'deployment',
        })
      ).snapshots,
    ).toStrictEqual([snapshot])
  })
})

describe('activity routes behind host authorization', () => {
  function app(status = 'current', failure: string | null = null) {
    const cap = capabilities(status, failure)
    const server = new Hono()
      .use('*', (c, next) => {
        c.set(
          'platform' as never,
          {
            authorization: { characterId: 9001 },
            collectionStatus: cap.collectionStatus,
            organization: { organizationVersion: 7 },
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
    expect(cap.readActivitySnapshots).not.toHaveBeenCalled()
  })
  test('uses only the host-owned character and strips private snapshot fields', async () => {
    const { cap, server } = app()
    const response = await server.request(`/participation/job/${id}?characterId=9002`)
    expect(await response.json()).toMatchObject({
      characterId: 9001,
      participation: [{ activityId: id, committed: true, contributed: 12 }],
    })
    expect(cap.read).toHaveBeenCalledWith('character-jobs', {
      characterId: 9001,
      kind: 'character',
    })
  })
  test('resolves a character-only job exclusively through the owned route', async () => {
    const { cap, server } = app()
    cap.readActivitySnapshots.mockImplementation(async ({ resourceId }) =>
      resourceId === 'character-jobs' ? [snapshot] : [],
    )
    expect(await (await server.request(`/details/job/${id}`)).json()).toMatchObject({
      activity: null,
    })
    expect(await (await server.request(`/participation/job/${id}`)).json()).toMatchObject({
      activity: { id },
      characterId: 9001,
    })
    cap.read.mockResolvedValue({
      authorizationGeneration: null,
      status: 'authorization-required',
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
      expect(await response.json()).toMatchObject({ activity: { id }, organizationVersion: 7 })
    },
  )

  test('normalizes stale detail and participation metadata onto each response root', async () => {
    const { server } = app('stale', 'esi-unavailable')

    const detail = await server.request(`/details/job/${id}`)
    const participation = await server.request(`/participation/job/${id}`)

    await expect(detail.json()).resolves.toMatchObject({
      refreshFailureClass: 'esi-unavailable',
      stale: true,
      validatedAt: '2026-09-07T10:00:00Z',
    })
    await expect(participation.json()).resolves.toMatchObject({
      refreshFailureClass: 'esi-unavailable',
      stale: true,
      validatedAt: '2026-09-07T10:00:00Z',
    })
  })

  test('does not invent a success timestamp for unavailable collection data', async () => {
    const { server } = app('unavailable')

    const body = await (await server.request(`/details/job/${id}`)).json()

    expect(body).toMatchObject({ activity: null, objectives: [], stale: false })
    expect(body).not.toHaveProperty('validatedAt')
  })
})
