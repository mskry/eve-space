import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  cacheDel: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  commit: vi.fn(),
  createEsiClient: vi.fn(),
  from: vi.fn(),
  getCharacterAuthorization: vi.fn(),
  getCharacterCacheAuthorization: vi.fn(),
  getCommitted: vi.fn(),
  getLeaseTtl: vi.fn(),
  getRevision: vi.fn(),
  getSkillQueue: vi.fn(),
  incrementRevision: vi.fn(),
  initialize: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
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
    del: mocks.cacheDel,
    get: mocks.cacheGet,
    ping: vi.fn().mockResolvedValue('PONG'),
    set: mocks.cacheSet,
  }),
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock((_definition, input) => mocks.getSkillQueue(input)),
)

const characterId = 1_404_328_063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const scope = 'esi-skills.read_skillqueue.v1'
const now = Date.parse('2026-09-01T11:00:00.000Z')
const lease = { fence: 7, key: 'lease', ownerToken: 'owner', ttlMs: 15_000 }
const publicMetadata = {
  cachedUntil: '2026-09-01T11:02:00.000Z',
  stale: false,
  validatedAt: '2026-09-01T11:00:00.000Z',
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
            groupId: 255,
            groupName: 'Gunnery',
            name: 'Gunnery',
            primaryAttribute: 'perception',
            secondaryAttribute: 'willpower',
          }),
          finishDate: '2026-08-30T12:00:00Z',
          levelEndSp: 512_000,
          levelStartSp: 256_000,
          startDate: '2026-08-29T12:00:00Z',
          trainingStartSp: 260_000,
        },
        queueEntry(2, 3301, 4, {
          groupId: 255,
          groupName: 'Gunnery',
          name: 'Small Hybrid Turret',
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
          finishDate: '2026-08-30T12:00:00Z',
          finishedLevel: 5,
          groupId: 255,
          groupName: 'Gunnery',
          levelEndSp: 512_000,
          levelStartSp: 256_000,
          name: 'Gunnery',
          primaryAttribute: 'perception',
          queuePosition: 1,
          secondaryAttribute: 'willpower',
          startDate: '2026-08-29T12:00:00Z',
          trainingStartSp: 260_000,
          typeId: 3300,
        },
        expect.objectContaining({
          primaryAttribute: 'perception',
          queuePosition: 2,
          secondaryAttribute: 'willpower',
          typeId: 3301,
        }),
      ],
    })
    expect(characterSkillQueueScope).toBe(scope)
    expect(mocks.getSkillQueue).toHaveBeenCalledWith({ characterId, subjectLifecycleId })
  })

  test('retains entries with deterministic unknown static labels', async () => {
    mocks.getSkillQueue.mockResolvedValue(response([queueEntry(0, 999_999, 1)]))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          groupId: null,
          groupName: 'Unknown',
          name: 'Unknown skill 999999',
          primaryAttribute: null,
          secondaryAttribute: null,
          typeId: 999_999,
        }),
      ],
    })
  })

  test('reports an empty queue from ESI without querying static data', async () => {
    mocks.getSkillQueue.mockResolvedValue(response([]))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      activeQueuePosition: null,
      entries: [],
      state: 'empty',
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test.each([
    {
      entries: [queueEntry(0, 3300, 5), queueEntry(1, 3301, 5)],
      expected: { activeQueuePosition: null, state: 'paused' },
      name: 'paused when no entry has started',
    },
    {
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
      expected: { activeQueuePosition: null, state: 'lapsed' },
      name: 'lapsed when every entry finished at or before the current time',
    },
    {
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
      expected: { activeQueuePosition: 1, state: 'training' },
      name: 'training on the first entry finishing after the current time',
    },
    {
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
      expected: { activeQueuePosition: null, state: 'paused' },
      name: 'paused when the first unfinished entry has no finish date',
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

    expect(second).toStrictEqual(first)
    expect(mocks.getSkillQueue).toHaveBeenCalledTimes(2)
  })

  test('classifies the queue against the current time rather than the cached representation', async () => {
    const entries = [
      queueEntry(0, 3300, 5, {
        finishDate: '2026-09-01T11:00:10.000Z',
        startDate: '2026-09-01T10:00:00.000Z',
      }),
      queueEntry(1, 3301, 5, {
        finishDate: '2026-09-01T11:00:40.000Z',
        startDate: '2026-09-01T10:00:00.000Z',
      }),
    ]
    mocks.getSkillQueue
      .mockResolvedValueOnce(response(entries))
      .mockResolvedValue(response(entries, 'cache'))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      activeQueuePosition: 0,
      state: 'training',
    })

    vi.setSystemTime(new Date('2026-09-01T11:00:15.000Z'))
    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      activeQueuePosition: 1,
      state: 'training',
    })

    vi.setSystemTime(new Date('2026-09-01T11:00:45.000Z'))
    await expect(getCharacterSkillQueue(characterId, subjectLifecycleId)).resolves.toMatchObject({
      activeQueuePosition: null,
      state: 'lapsed',
    })

    expect(mocks.getSkillQueue).toHaveBeenCalledTimes(3)
  })
})

function response(data: QueueEntry[], source: 'cache' | 'esi' = 'esi') {
  return {
    cachedUntil: publicMetadata.cachedUntil,
    data: { entries: data },
    quota: {},
    source,
    stale: false,
    validatedAt: publicMetadata.validatedAt,
  }
}

function queueEntry(
  queuePosition: number,
  typeId: number,
  finishedLevel: number,
  overrides: Partial<QueueEntry> = {},
): QueueEntry {
  return {
    finishDate: null,
    finishedLevel,
    groupId: null,
    groupName: 'Unknown',
    levelEndSp: null,
    levelStartSp: null,
    name: `Unknown skill ${typeId}`,
    primaryAttribute: null,
    queuePosition,
    secondaryAttribute: null,
    startDate: null,
    trainingStartSp: null,
    typeId,
    ...overrides,
  }
}
