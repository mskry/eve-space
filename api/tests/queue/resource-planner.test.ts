import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { derivedResourcePriorityBand, resourceRefreshPriority } from '../../src/queue/policy.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'
import { runResourcePlanner } from '../../src/queue/resource-planner.js'

const plannerMocks = vi.hoisted(() => ({
  getCooldowns: vi.fn(),
  selectDue: vi.fn(),
}))

vi.mock('../../src/platform/resource-eligibility.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/platform/resource-eligibility.js')>()),
  selectDueInstalledResources: plannerMocks.selectDue,
}))
vi.mock('../../src/platform/resource-planning.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/platform/resource-planning.js')>()),
  getResourcePlanningCooldowns: plannerMocks.getCooldowns,
}))

const resource = {
  eligibility: { kind: 'current-owned-character' },
  implementation: {},
  materializationIntervalSeconds: 900,
  moduleId: 'member-audit',
  operationId: 'skills',
  resourceId: 'character-skills',
  subjectKind: 'character',
} as const satisfies PlatformInstalledResourceDescriptor

const batchResource = {
  ...resource,
  batch: { mode: 'complete-observation', operationId: 'universe-resolve-names' },
} as const satisfies PlatformInstalledResourceDescriptor

beforeEach(() => {
  plannerMocks.selectDue.mockReset().mockResolvedValue([])
  plannerMocks.getCooldowns.mockReset().mockImplementation((requests: readonly unknown[]) =>
    Promise.resolve(
      requests.map(() => ({
        active: false,
        coordinationAvailable: true,
        retryAfterSeconds: null,
      })),
    ),
  )
})

describe('generic resource planner', () => {
  test('is idle without installed resources and touches no external boundary', async () => {
    await expect(runResourcePlanner(context(), { resources: [] })).resolves.toStrictEqual({
      planned: 0,
      reason: 'idle',
      selected: 0,
    })
    expect(plannerMocks.selectDue).not.toHaveBeenCalled()
  })

  test('does not schedule resources whose collectors are not materialized', async () => {
    await expect(
      runResourcePlanner(context(), { resources: [{ ...resource, scheduled: false }] }),
    ).resolves.toStrictEqual({
      planned: 0,
      reason: 'idle',
      selected: 0,
    })
    expect(plannerMocks.selectDue).not.toHaveBeenCalled()
  })

  test('bounds PostgreSQL selection by remaining high-water capacity', async () => {
    await runResourcePlanner(context({ depth: 5 }), {
      highWaterMark: 7,
      pageSize: 5,
      resources: [resource],
    })
    expect(plannerMocks.selectDue).toHaveBeenCalledWith({ limit: 2, resources: [resource] })
  })

  test('does not query PostgreSQL when queue capacity is exhausted', async () => {
    await expect(
      runResourcePlanner(context({ depth: 3 }), {
        highWaterMark: 3,
        resources: [resource],
      }),
    ).resolves.toMatchObject({ planned: 0, reason: 'capacity', selected: 0 })
    expect(plannerMocks.selectDue).not.toHaveBeenCalled()
  })

  test('preserves an affiliation cooldown pause through resource publication', async () => {
    const candidate = dueResource('1404328063')
    plannerMocks.selectDue.mockResolvedValue([candidate])
    const subject = context()
    await subject.producer.pausePlanner()

    await runResourcePlanner(subject, { resources: [resource] })

    expect(subject.producer.commands).toHaveLength(1)
    expect(subject.producer.plannerPaused).toBe(true)
  })

  test('reports a concurrent publication capacity rejection', async () => {
    const candidate = dueResource('1404328063')
    plannerMocks.selectDue.mockResolvedValue([candidate])
    const subject = context()
    subject.producer.enqueueMany = vi.fn().mockResolvedValue([
      {
        depth: 1000,
        reason: 'planner-paused',
        status: 'rejected',
      },
    ])

    await expect(runResourcePlanner(subject, { resources: [resource] })).resolves.toMatchObject({
      planned: 0,
      reason: 'capacity',
      selected: 1,
    })
  })

  test('emits prioritized scalar commands using execution-principal cooldown identity', async () => {
    const candidate = dueResource('1404328063')
    plannerMocks.selectDue.mockResolvedValue([candidate])
    const subject = context()

    await expect(runResourcePlanner(subject, { resources: [resource] })).resolves.toMatchObject({
      planned: 1,
      reason: 'scheduled',
      selected: 1,
    })

    expect(plannerMocks.getCooldowns).toHaveBeenCalledWith([
      { characterId: 1_404_328_063, operation: 'skills' },
    ])
    expect(subject.producer.commands).toStrictEqual([
      {
        materializationIntervalSeconds: 900,
        name: 'resource-refresh',
        payload: candidate.identity,
        source: 'planner',
      },
    ])
  })

  test('stops at the first cooldown and leaves the suffix due', async () => {
    const candidates = [dueResource('1404328063'), dueResource('1404328064')]
    plannerMocks.selectDue.mockResolvedValue(candidates)
    plannerMocks.getCooldowns.mockResolvedValueOnce([
      { active: false, coordinationAvailable: true, retryAfterSeconds: null },
      { active: true, coordinationAvailable: true, retryAfterSeconds: 12 },
    ])
    const subject = context()

    await expect(runResourcePlanner(subject, { resources: [resource] })).resolves.toMatchObject({
      planned: 1,
      reason: 'cooldown',
      selected: 2,
    })
    expect(subject.producer.commands).toHaveLength(1)
  })

  test('groups a deterministic bounded batch into one semantic command', async () => {
    const candidates = [
      dueResource('1404328063', batchResource),
      dueResource('1404328064', batchResource),
    ]
    plannerMocks.selectDue.mockResolvedValue(candidates)
    const subject = context()

    await expect(
      runResourcePlanner(subject, { resources: [batchResource] }),
    ).resolves.toMatchObject({ planned: 1, reason: 'scheduled', selected: 2 })
    const command = subject.producer.commands[0]
    expect(command).toMatchObject({
      materializationIntervalSeconds: 900,
      name: 'resource-batch',
      source: 'planner',
    })
    if (command?.name !== 'resource-batch') {
      throw new Error('Expected a resource batch command')
    }
    expect(command.payload.subjects.map(({ subjectId }) => subjectId)).toStrictEqual([
      '1404328063',
      '1404328064',
    ])
  })

  test('keeps resource priorities below unprioritized authoritative work', () => {
    expect(resourceRefreshPriority(1)).toBe(derivedResourcePriorityBand.highest)
    expect(resourceRefreshPriority(300)).toBeLessThan(resourceRefreshPriority(900))
    expect(resourceRefreshPriority(derivedResourcePriorityBand.lowest + 1)).toBe(
      derivedResourcePriorityBand.lowest,
    )
    expect(() => resourceRefreshPriority(0)).toThrow('positive safe integer')
  })
})

function context(options: { depth?: number } = {}) {
  return {
    outcomes: {
      recordAffiliation: vi.fn().mockResolvedValue(undefined),
      recordOutbox: vi.fn().mockResolvedValue(undefined),
    },
    producer: createInMemoryQueueProducer({ depth: options.depth }),
  }
}

function dueResource(
  subjectId: string,
  descriptor: PlatformInstalledResourceDescriptor = resource,
) {
  return {
    identity: {
      moduleId: descriptor.moduleId,
      resourceId: descriptor.resourceId,
      subjectId,
      subjectKind: descriptor.subjectKind,
      subjectLifecycleId: '6f80b8de-8ff0-4dc6-af2c-9fb5c892174a',
    },
    operationId: descriptor.operationId as 'skills',
  }
}
