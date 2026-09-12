import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  createEsiClient: vi.fn(),
  getSkillQueue: vi.fn(),
  getCharacterAuthorization: vi.fn(),
  getCharacterCacheAuthorization: vi.fn(),
  acquire: vi.fn(),
  commit: vi.fn(),
  getCommitted: vi.fn(),
  getLeaseTtl: vi.fn(),
  getRevision: vi.fn(),
  incrementRevision: vi.fn(),
  initialize: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  staticRows: [] as Array<{
    typeId: number
    typeName: string
    groupId: number
    groupName: string
    attributeId: number | null
    attributeValue: number | null
  }>,
  where: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorization,
  getCharacterCacheAuthorizationForLifecycle: mocks.getCharacterCacheAuthorization,
}))
vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    del: mocks.cacheDel,
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock((_definition, input) => mocks.getSkillQueue(input)),
)

const characterId = 1404328063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const scope = 'esi-skills.read_skillqueue.v1'
const now = Date.parse('2026-09-01T11:00:00.000Z')
const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 15_000 }
const publicMetadata = {
  cachedUntil: '2026-09-01T11:02:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  stale: false,
}

interface QueueEntry {
  queuePosition: number
  typeId: number
  name: string
  groupId: number | null
  groupName: string
  finishedLevel: number
  levelStartSp: number | null
  levelEndSp: number | null
  trainingStartSp: number | null
  startDate: string | null
  finishDate: string | null
  primaryAttribute: string | null
  secondaryAttribute: string | null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetModules()
  mocks.getSkillQueue.mockReset()
  mocks.createEsiClient.mockReset()
  mocks.getCharacterAuthorization.mockReset()
  mocks.getCharacterCacheAuthorization.mockReset()
  mocks.acquire.mockReset()
  mocks.commit.mockReset()
  mocks.getCommitted.mockReset()
  mocks.getLeaseTtl.mockReset()
  mocks.getRevision.mockReset()
  mocks.incrementRevision.mockReset()
  mocks.initialize.mockReset()
  mocks.release.mockReset()
  mocks.renew.mockReset()
  mocks.cacheGet.mockReset()
  mocks.cacheSet.mockReset()
  mocks.cacheDel.mockReset()
  mocks.select.mockReset()
  mocks.from.mockReset()
  mocks.innerJoin.mockReset()
  mocks.leftJoin.mockReset()
  mocks.where.mockReset()
  mocks.staticRows.splice(0)

  mocks.getCharacterAuthorization.mockResolvedValue({
    accessToken: 'access-token',
    tokenVersion: 1,
  })
  mocks.getCharacterCacheAuthorization.mockResolvedValue({ scopes: [scope], tokenVersion: 1 })
  mocks.acquire.mockResolvedValue(lease)
  mocks.commit.mockResolvedValue(true)
  mocks.getCommitted.mockResolvedValue(undefined)
  mocks.getLeaseTtl.mockResolvedValue(0)
  mocks.initialize.mockResolvedValue('namespace-one')
  mocks.release.mockResolvedValue(true)
  mocks.renew.mockResolvedValue(true)
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue('OK')
  mocks.cacheDel.mockResolvedValue(1)
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin })
  mocks.innerJoin.mockReturnValue({ leftJoin: mocks.leftJoin })
  mocks.leftJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockImplementation(async () => mocks.staticRows)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('character skill queue', () => {
  test('loads and enriches the queue through the registered execution seam', async () => {
    mocks.getSkillQueue.mockResolvedValue(
      response([
        {
          ...queueEntry(1, 3300, 5, {
            name: 'Gunnery',
            groupId: 255,
            groupName: 'Gunnery',
            primaryAttribute: 'perception',
            secondaryAttribute: 'willpower',
          }),
          startDate: '2026-08-29T12:00:00Z',
          finishDate: '2026-08-30T12:00:00Z',
          levelStartSp: 256000,
          levelEndSp: 512000,
          trainingStartSp: 260000,
        },
        queueEntry(2, 3301, 4, {
          name: 'Small Hybrid Turret',
          groupId: 255,
          groupName: 'Gunnery',
          primaryAttribute: 'perception',
          secondaryAttribute: 'willpower',
        }),
      ]),
    )
    const { characterSkillQueueScope, getCharacterSkillQueue } =
      await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      ...publicMetadata,
      entries: [
        {
          queuePosition: 1,
          typeId: 3300,
          name: 'Gunnery',
          groupId: 255,
          groupName: 'Gunnery',
          finishedLevel: 5,
          levelStartSp: 256000,
          levelEndSp: 512000,
          trainingStartSp: 260000,
          startDate: '2026-08-29T12:00:00Z',
          finishDate: '2026-08-30T12:00:00Z',
          primaryAttribute: 'perception',
          secondaryAttribute: 'willpower',
        },
        expect.objectContaining({
          queuePosition: 2,
          typeId: 3301,
          primaryAttribute: 'perception',
          secondaryAttribute: 'willpower',
        }),
      ],
    })
    expect(characterSkillQueueScope).toBe(scope)
    expect(mocks.getSkillQueue).toHaveBeenCalledWith({ characterId, subjectLifecycleId })
  })

  test('retains entries with deterministic unknown static labels', async () => {
    mocks.getSkillQueue.mockResolvedValue(response([queueEntry(0, 999999, 1)]))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          typeId: 999999,
          name: 'Unknown skill 999999',
          groupId: null,
          groupName: 'Unknown',
          primaryAttribute: null,
          secondaryAttribute: null,
        }),
      ],
    })
  })

  test('reports an empty queue from ESI without querying static data', async () => {
    mocks.getSkillQueue.mockResolvedValue(response([]))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      state: 'empty',
      activeQueuePosition: null,
      entries: [],
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test.each([
    {
      name: 'paused when no entry has started',
      entries: [queueEntry(0, 3300, 5), queueEntry(1, 3301, 5)],
      expected: { state: 'paused', activeQueuePosition: null },
    },
    {
      name: 'lapsed when every entry finished at or before the current time',
      entries: [
        queueEntry(0, 3300, 5, {
          startDate: '2026-08-30T10:00:00.000Z',
          finishDate: '2026-08-31T10:00:00.000Z',
        }),
        queueEntry(1, 3301, 5, {
          startDate: '2026-08-31T10:00:00.000Z',
          finishDate: '2026-09-01T11:00:00.000Z',
        }),
      ],
      expected: { state: 'lapsed', activeQueuePosition: null },
    },
    {
      name: 'training on the first entry finishing after the current time',
      entries: [
        queueEntry(0, 3300, 5, {
          startDate: '2026-08-31T10:00:00.000Z',
          finishDate: '2026-09-01T11:00:00.000Z',
        }),
        queueEntry(1, 3301, 5, {
          startDate: '2026-09-01T10:00:00.000Z',
          finishDate: '2026-09-01T12:00:00.000Z',
        }),
        queueEntry(2, 3302, 5, {
          startDate: '2026-09-01T12:00:00.000Z',
          finishDate: '2026-09-02T12:00:00.000Z',
        }),
      ],
      expected: { state: 'training', activeQueuePosition: 1 },
    },
    {
      name: 'paused when the first unfinished entry has no finish date',
      entries: [
        queueEntry(0, 3300, 5, {
          startDate: '2026-08-31T10:00:00.000Z',
          finishDate: '2026-09-01T10:00:00.000Z',
        }),
        queueEntry(1, 3301, 5, {
          startDate: '2026-09-01T10:00:00.000Z',
          finishDate: null,
        }),
      ],
      expected: { state: 'paused', activeQueuePosition: null },
    },
  ])('reports $name through the character skill-queue interface', async ({ entries, expected }) => {
    mocks.getSkillQueue.mockResolvedValue(response(entries))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject(
      expected,
    )
  })

  test('serves a repeated request from the L1 cache without another ESI call', async () => {
    mocks.getSkillQueue
      .mockResolvedValueOnce(response([queueEntry(0, 3300, 5)]))
      .mockResolvedValueOnce(response([queueEntry(0, 3300, 5)], 'cache'))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    const first = await getCharacterSkillQueue(characterId, subjectLifecycleId)
    const second = await getCharacterSkillQueue(characterId, subjectLifecycleId)

    expect(second).toEqual(first)
    expect(mocks.getSkillQueue).toHaveBeenCalledTimes(2)
  })

  test('classifies the queue against the current time rather than the cached representation', async () => {
    const entries = [
      queueEntry(0, 3300, 5, {
        startDate: '2026-09-01T10:00:00.000Z',
        finishDate: '2026-09-01T11:00:10.000Z',
      }),
      queueEntry(1, 3301, 5, {
        startDate: '2026-09-01T10:00:00.000Z',
        finishDate: '2026-09-01T11:00:40.000Z',
      }),
    ]
    mocks.getSkillQueue
      .mockResolvedValueOnce(response(entries))
      .mockResolvedValue(response(entries, 'cache'))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      state: 'training',
      activeQueuePosition: 0,
    })

    vi.setSystemTime(new Date('2026-09-01T11:00:15.000Z'))
    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      state: 'training',
      activeQueuePosition: 1,
    })

    vi.setSystemTime(new Date('2026-09-01T11:00:45.000Z'))
    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      state: 'lapsed',
      activeQueuePosition: null,
    })

    expect(mocks.getSkillQueue).toHaveBeenCalledTimes(3)
  })
})

function response(data: QueueEntry[], source: 'cache' | 'esi' = 'esi') {
  return {
    data: { entries: data },
    cachedUntil: publicMetadata.cachedUntil,
    validatedAt: publicMetadata.validatedAt,
    quota: {},
    source,
    stale: false,
  }
}

function queueEntry(
  queuePosition: number,
  typeId: number,
  finishedLevel: number,
  overrides: Partial<QueueEntry> = {},
): QueueEntry {
  return {
    queuePosition,
    typeId,
    name: `Unknown skill ${typeId}`,
    groupId: null,
    groupName: 'Unknown',
    finishedLevel,
    levelStartSp: null,
    levelEndSp: null,
    trainingStartSp: null,
    startDate: null,
    finishDate: null,
    primaryAttribute: null,
    secondaryAttribute: null,
    ...overrides,
  }
}
