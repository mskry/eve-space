import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

vi.mock('@evespace/esi-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@evespace/esi-client')>()
  return {
    ...original,
    EsiClient: class {
      constructor(options: unknown) {
        mocks.createEsiClient(options)
      }

      callOperation(...arguments_: unknown[]) {
        return mocks.getSkillQueue(...arguments_)
      }
    },
  }
})
vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorization: mocks.getCharacterAuthorization,
  getCharacterCacheAuthorization: mocks.getCharacterCacheAuthorization,
}))
vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    del: mocks.cacheDel,
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
}))
vi.mock('../../src/esi-resilience/coordination-connection.js', () => ({
  getCoordinationConnection: () => ({}),
}))
vi.mock('../../src/esi-resilience/coordination.js', () => ({
  acquireEsiRequestLease: mocks.acquire,
  commitEsiFence: mocks.commit,
  getCommittedEsiFence: mocks.getCommitted,
  getEsiRequestLeaseTtl: mocks.getLeaseTtl,
  getEsiResourceRevision: mocks.getRevision,
  incrementEsiResourceRevision: mocks.incrementRevision,
  initializeCacheNamespace: mocks.initialize,
  releaseEsiRequestLease: mocks.release,
  renewEsiRequestLease: mocks.renew,
}))

const characterId = 1404328063
const scope = 'esi-skills.read_skillqueue.v1'
const now = Date.parse('2026-09-01T11:00:00.000Z')
const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 15_000 }
const publicMetadata = {
  cachedUntil: '2026-09-01T11:02:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  stale: false,
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
        queueEntry(2, 3301, 4),
        {
          ...queueEntry(1, 3300, 5),
          start_date: '2026-08-29T12:00:00Z',
          finish_date: '2026-08-30T12:00:00Z',
          level_start_sp: 256000,
          level_end_sp: 512000,
          training_start_sp: 260000,
        },
      ]),
    )
    mocks.staticRows.push(
      staticRow(3300, 'Gunnery', 255, 'Gunnery', 180, 167),
      staticRow(3300, 'Gunnery', 255, 'Gunnery', 181, 168),
      staticRow(3301, 'Small Hybrid Turret', 255, 'Gunnery', 180, 167),
      staticRow(3301, 'Small Hybrid Turret', 255, 'Gunnery', 181, 168),
    )
    const { characterSkillQueueScope, getCharacterSkillQueue } =
      await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
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
    expect(mocks.getCharacterCacheAuthorization).toHaveBeenCalledWith(characterId, scope)
    expect(mocks.getCharacterAuthorization).toHaveBeenCalledWith(characterId, scope)
    expect(mocks.getSkillQueue).toHaveBeenCalledWith('GetCharactersCharacterIdSkillqueue', {
      path: { character_id: characterId },
    })
    expect(mocks.select).toHaveBeenCalledOnce()
  })

  test('retains entries with deterministic unknown static labels', async () => {
    mocks.getSkillQueue.mockResolvedValue(response([queueEntry(0, 999999, 1)]))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
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

    await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
      state: 'empty',
      activeQueuePosition: null,
      entries: [],
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('serves a repeated request from the L1 cache without another ESI call', async () => {
    mocks.getSkillQueue.mockResolvedValue(response([queueEntry(0, 3300, 5)]))
    mocks.staticRows.push(staticRow(3300, 'Gunnery', 255, 'Gunnery', 180, 167))
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    const first = await getCharacterSkillQueue(characterId)
    const second = await getCharacterSkillQueue(characterId)

    expect(second).toEqual(first)
    expect(mocks.getSkillQueue).toHaveBeenCalledOnce()
    expect(mocks.select).toHaveBeenCalledOnce()
  })

  test('classifies the queue against the current time rather than the cached representation', async () => {
    mocks.getSkillQueue.mockResolvedValue(
      response([
        rawQueueEntry(0, 3300, 5, '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:10.000Z'),
        rawQueueEntry(1, 3301, 5, '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:40.000Z'),
      ]),
    )
    mocks.staticRows.push(
      staticRow(3300, 'Gunnery', 255, 'Gunnery', 180, 167),
      staticRow(3301, 'Small Hybrid Turret', 255, 'Gunnery', 180, 167),
    )
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
      state: 'training',
      activeQueuePosition: 0,
    })

    vi.setSystemTime(new Date('2026-09-01T11:00:15.000Z'))
    await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
      state: 'training',
      activeQueuePosition: 1,
    })

    vi.setSystemTime(new Date('2026-09-01T11:00:45.000Z'))
    await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
      state: 'lapsed',
      activeQueuePosition: null,
    })

    expect(mocks.getSkillQueue).toHaveBeenCalledOnce()
  })
})

describe('resolveSkillQueueState', () => {
  const referenceNow = Date.parse('2026-08-29T12:00:00Z')

  test('reports an empty queue', async () => {
    const { resolveSkillQueueState } = await import('../../src/characters/skill-queue.js')

    expect(resolveSkillQueueState([], referenceNow)).toEqual({
      state: 'empty',
      activeQueuePosition: null,
    })
  })

  test('reports a paused queue when no entry carries a start date', async () => {
    const { resolveSkillQueueState } = await import('../../src/characters/skill-queue.js')

    expect(
      resolveSkillQueueState([entryAt(0, null, null), entryAt(1, null, null)], referenceNow),
    ).toEqual({
      state: 'paused',
      activeQueuePosition: null,
    })
  })

  test('reports a lapsed queue when every entry finished in the past', async () => {
    const { resolveSkillQueueState } = await import('../../src/characters/skill-queue.js')

    expect(
      resolveSkillQueueState(
        [
          entryAt(0, '2026-08-27T10:00:00Z', '2026-08-28T10:00:00Z'),
          entryAt(1, '2026-08-28T10:00:00Z', '2026-08-29T10:00:00Z'),
        ],
        referenceNow,
      ),
    ).toEqual({ state: 'lapsed', activeQueuePosition: null })
  })

  test('identifies the first unfinished entry as the one training', async () => {
    const { resolveSkillQueueState } = await import('../../src/characters/skill-queue.js')

    expect(
      resolveSkillQueueState(
        [
          entryAt(0, '2026-08-28T10:00:00Z', '2026-08-29T10:00:00Z'),
          entryAt(1, '2026-08-29T10:00:00Z', '2026-08-29T18:00:00Z'),
          entryAt(2, '2026-08-29T18:00:00Z', '2026-08-30T18:00:00Z'),
        ],
        referenceNow,
      ),
    ).toEqual({ state: 'training', activeQueuePosition: 1 })
  })

  test('reports a paused queue when the first unfinished entry has no finish date', async () => {
    const { resolveSkillQueueState } = await import('../../src/characters/skill-queue.js')

    expect(
      resolveSkillQueueState(
        [
          entryAt(0, '2026-08-28T10:00:00Z', '2026-08-29T10:00:00Z'),
          entryAt(1, '2026-08-29T10:00:00Z', null),
        ],
        referenceNow,
      ),
    ).toEqual({ state: 'paused', activeQueuePosition: null })
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}

function queueEntry(queuePosition: number, skillId: number, finishedLevel: number) {
  return { queue_position: queuePosition, skill_id: skillId, finished_level: finishedLevel }
}

function rawQueueEntry(
  queuePosition: number,
  skillId: number,
  finishedLevel: number,
  startDate: string,
  finishDate: string,
) {
  return {
    ...queueEntry(queuePosition, skillId, finishedLevel),
    start_date: startDate,
    finish_date: finishDate,
  }
}

function entryAt(queuePosition: number, startDate: string | null, finishDate: string | null) {
  return {
    queuePosition,
    typeId: 3300 + queuePosition,
    name: `Skill ${queuePosition}`,
    groupId: 255,
    groupName: 'Gunnery',
    finishedLevel: 5,
    levelStartSp: 256000,
    levelEndSp: 512000,
    trainingStartSp: 256000,
    startDate,
    finishDate,
    primaryAttribute: 'perception' as const,
    secondaryAttribute: 'willpower' as const,
  }
}

function staticRow(
  typeId: number,
  typeName: string,
  groupId: number,
  groupName: string,
  attributeId: number,
  attributeValue: number,
) {
  return { typeId, typeName, groupId, groupName, attributeId, attributeValue }
}
