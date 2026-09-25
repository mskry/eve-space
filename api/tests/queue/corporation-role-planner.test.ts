import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const mocks = vi.hoisted(() => ({
  cooldownActive: vi.fn(),
  selectDue: vi.fn(),
}))

vi.mock('../../src/characters/corporation-role-observation.js', () => ({
  corporationRoleCooldownActive: mocks.cooldownActive,
}))
vi.mock('../../src/organization/corporation-role-demand.js', () => ({
  selectDueCorporationRoleDemand: mocks.selectDue,
}))

const { runCorporationRolePlanner } = await import('../../src/queue/corporation-role-planner.js')

const now = new Date('2026-09-25T12:00:00.000Z')
const demand = (characterId: number, nextRefreshAt: Date | null) => ({
  affiliationPeriodRevision: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
  authorityCorporationId: 98_000_001,
  authorizationGeneration: 7,
  characterId,
  consumers: ['corporation-source', 'derived-director', 'organization-owner'],
  expectedRoleRevision: null,
  nextRefreshAt,
  organizationVersion: 3,
  subjectLifecycleId: `35acd527-9539-44ad-aacf-9f8e4523${String(characterId).padStart(4, '0')}`,
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
})

beforeEach(() => {
  mocks.cooldownActive.mockResolvedValue(false)
  mocks.selectDue.mockReset()
})

describe('corporation-role planner', () => {
  test('admits due demand ahead of expiry without executing before the persisted due time', async () => {
    const dueLater = new Date('2026-09-25T12:15:00.000Z')
    mocks.selectDue.mockResolvedValue([demand(1, null), demand(2, dueLater)])
    const producer = createInMemoryQueueProducer()

    await expect(
      runCorporationRolePlanner({ outcomes: {} as never, producer }, now),
    ).resolves.toStrictEqual({ planned: 2, reason: 'scheduled' })

    expect(mocks.selectDue).toHaveBeenCalledWith({
      dueBefore: new Date('2026-09-25T12:20:00.000Z'),
      limit: 100,
    })
    expect(producer.commands).toMatchObject([
      { name: 'corporation-role-observation', notBefore: now, payload: { characterId: 1 } },
      { name: 'corporation-role-observation', notBefore: dueLater, payload: { characterId: 2 } },
    ])
    expect(JSON.stringify(producer.commands)).not.toMatch(/consumers|Director|roles/)
  })

  test('coalesces duplicate demand and reconstructs dropped work on the next pass', async () => {
    mocks.selectDue.mockResolvedValue([demand(1, null)])
    const producer = createInMemoryQueueProducer()

    await runCorporationRolePlanner({ outcomes: {} as never, producer }, now)
    await expect(
      runCorporationRolePlanner({ outcomes: {} as never, producer }, now),
    ).resolves.toStrictEqual({ planned: 0, reason: 'idle' })
    expect(producer.commands).toHaveLength(1)

    const afterQueueLoss = createInMemoryQueueProducer()
    await expect(
      runCorporationRolePlanner({ outcomes: {} as never, producer: afterQueueLoss }, now),
    ).resolves.toStrictEqual({ planned: 1, reason: 'scheduled' })
  })

  test('pages beyond a full page of coalesced jobs to admit later demand', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => demand(index + 1, null))
    mocks.selectDue.mockResolvedValue(firstPage)
    const producer = createInMemoryQueueProducer({ highWaterMark: 101 })
    const outcomes = { recordAffiliation: async () => {}, recordOutbox: async () => {} }
    await expect(runCorporationRolePlanner({ outcomes, producer }, now)).resolves.toStrictEqual({
      planned: 100,
      reason: 'scheduled',
    })

    mocks.selectDue.mockReset()
    mocks.selectDue.mockImplementation(({ after }: { after?: { characterId: number } }) =>
      after ? [demand(101, null)] : firstPage,
    )
    await expect(runCorporationRolePlanner({ outcomes, producer }, now)).resolves.toStrictEqual({
      planned: 1,
      reason: 'scheduled',
    })
    expect(mocks.selectDue).toHaveBeenNthCalledWith(2, {
      after: { characterId: 100, nextRefreshAt: null },
      dueBefore: new Date('2026-09-25T12:20:00.000Z'),
      limit: 100,
    })
    expect(producer.commands).toHaveLength(101)
    expect(producer.commands.at(-1)?.payload).toMatchObject({ characterId: 101 })
  })

  test('stops at queue capacity and leaves omitted demand in PostgreSQL', async () => {
    mocks.selectDue.mockResolvedValue([demand(1, null), demand(2, null)])
    const producer = createInMemoryQueueProducer({ highWaterMark: 1 })

    await expect(
      runCorporationRolePlanner({ outcomes: {} as never, producer }, now),
    ).resolves.toStrictEqual({ planned: 1, reason: 'planner-paused' })
    expect(producer.commands).toHaveLength(1)
  })

  test('skips planning while the role operation is cooling down', async () => {
    mocks.cooldownActive.mockResolvedValue(true)
    const producer = createInMemoryQueueProducer()

    await expect(
      runCorporationRolePlanner({ outcomes: {} as never, producer }, now),
    ).resolves.toStrictEqual({ planned: 0, reason: 'cooldown' })
    expect(mocks.selectDue).not.toHaveBeenCalled()
  })

  test('honors cancellation before selecting demand', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runCorporationRolePlanner(
        {
          outcomes: {} as never,
          producer: createInMemoryQueueProducer(),
          signal: controller.signal,
        },
        now,
      ),
    ).rejects.toBe(controller.signal.reason)
    expect(mocks.selectDue).not.toHaveBeenCalled()
  })
})

describe('due-time admission delay', () => {
  test('never executes early and bounds the persisted delay to the planner lead window', async () => {
    const { corporationRoleRefreshLeadMilliseconds, dueTimeAdmissionDelay } =
      await import('../../src/queue/policy.js')
    const base = now.getTime()

    expect(dueTimeAdmissionDelay(new Date(base - 1000), base)).toBe(0)
    expect(dueTimeAdmissionDelay(new Date(base + 90_000), base)).toBe(90_000)
    expect(dueTimeAdmissionDelay(new Date(base + 24 * 60 * 60_000), base)).toBe(
      corporationRoleRefreshLeadMilliseconds,
    )
    expect(dueTimeAdmissionDelay(new Date(Number.NaN), base)).toBe(0)
  })
})
