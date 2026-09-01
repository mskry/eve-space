import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSkillsClient: vi.fn(),
  createEsiTransport: vi.fn(),
  get: vi.fn(),
  getSkillQueue: vi.fn(),
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

vi.mock('@evespace/esi-client/domains/skills', () => ({
  createSkillsClient: mocks.createSkillsClient,
}))
vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))

const characterId = 1404328063
const revalidation = { ifNoneMatch: 'etag', ifModifiedSince: 'date' }
const esiMetadata = {
  cachedUntil: '2026-09-01T11:01:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}
const publicMetadata = {
  cachedUntil: esiMetadata.cachedUntil,
  validatedAt: esiMetadata.validatedAt,
  stale: false,
}

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load(
      { accessToken: 'access-token', principal: `character-${characterId}` },
      revalidation,
    )
    return { data: loaded.data, ...esiMetadata }
  })
  mocks.createSkillsClient.mockReturnValue({
    withMetadata: () => ({ getSkillQueue: mocks.getSkillQueue }),
  })
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin })
  mocks.innerJoin.mockReturnValue({ leftJoin: mocks.leftJoin })
  mocks.leftJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockImplementation(async () => mocks.staticRows)
  mocks.staticRows.splice(0)
})

describe('character skill queue', () => {
  test('loads and enriches the queue through its private resource', async () => {
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
    expect(characterSkillQueueScope).toBe('esi-skills.read_skillqueue.v1')
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'skill-queue',
      inputs: { characterId },
    })
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('skill-queue', `character-${characterId}`)
    expect(mocks.getSkillQueue).toHaveBeenCalledWith(characterId, revalidation)
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

  test('returns cached entries without querying ESI or static data', async () => {
    mocks.get.mockResolvedValueOnce({
      data: { entries: [] },
      cachedUntil: '',
      validatedAt: '2026-09-01T11:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: false,
    })
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    await expect(getCharacterSkillQueue(characterId)).resolves.toEqual({
      state: 'empty',
      activeQueuePosition: null,
      entries: [],
      cachedUntil: '',
      validatedAt: '2026-09-01T11:00:00.000Z',
      stale: false,
    })
    expect(mocks.getSkillQueue).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('classifies the queue against the current time rather than the cached representation', async () => {
    const entries = [
      entryAt(0, '2026-08-29T10:00:00Z', '2026-08-29T14:00:00Z'),
      entryAt(1, '2026-08-29T14:00:00Z', '2026-08-29T20:00:00Z'),
    ]
    mocks.get.mockResolvedValue({
      data: { entries },
      cachedUntil: '',
      validatedAt: '2026-09-01T11:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: false,
    })
    const { getCharacterSkillQueue } = await import('../../src/characters/skill-queue.js')

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-29T12:00:00Z'))
      await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
        state: 'training',
        activeQueuePosition: 0,
      })

      vi.setSystemTime(new Date('2026-08-29T16:00:00Z'))
      await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
        state: 'training',
        activeQueuePosition: 1,
      })

      vi.setSystemTime(new Date('2026-08-30T00:00:00Z'))
      await expect(getCharacterSkillQueue(characterId)).resolves.toMatchObject({
        state: 'lapsed',
        activeQueuePosition: null,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('resolveSkillQueueState', () => {
  const now = Date.parse('2026-08-29T12:00:00Z')

  test('reports an empty queue', async () => {
    const { resolveSkillQueueState } = await import('../../src/characters/skill-queue.js')

    expect(resolveSkillQueueState([], now)).toEqual({ state: 'empty', activeQueuePosition: null })
  })

  test('reports a paused queue when no entry carries a start date', async () => {
    const { resolveSkillQueueState } = await import('../../src/characters/skill-queue.js')

    expect(resolveSkillQueueState([entryAt(0, null, null), entryAt(1, null, null)], now)).toEqual({
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
        now,
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
        now,
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
        now,
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
