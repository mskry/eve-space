import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
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
  moduleId: 'member-audit',
  resourceId: 'character-skills',
  operationId: 'skills',
  subjectKind: 'character',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation: {},
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
        retryAfterSeconds: null,
        coordinationAvailable: true,
      })),
    ),
  )
})

describe('generic resource planner', () => {
  test('is idle without installed resources and touches no external boundary', async () => {
    await expect(runResourcePlanner(context(), { resources: [] })).resolves.toEqual({
      selected: 0,
      planned: 0,
      reason: 'idle',
    })
    expect(plannerMocks.selectDue).not.toHaveBeenCalled()
  })

  test('bounds PostgreSQL selection by remaining high-water capacity', async () => {
    await runResourcePlanner(context({ depth: 5 }), {
      resources: [resource],
      pageSize: 5,
      highWaterMark: 7,
    })
    expect(plannerMocks.selectDue).toHaveBeenCalledWith({ limit: 2, resources: [resource] })
  })

  test('does not query PostgreSQL when queue capacity is exhausted', async () => {
    await expect(
      runResourcePlanner(context({ depth: 3 }), {
        resources: [resource],
        highWaterMark: 3,
      }),
    ).resolves.toMatchObject({ selected: 0, planned: 0, reason: 'capacity' })
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
        status: 'rejected',
        depth: 1_000,
        reason: 'planner-paused',
      },
    ])

    await expect(runResourcePlanner(subject, { resources: [resource] })).resolves.toMatchObject({
      selected: 1,
      planned: 0,
      reason: 'capacity',
    })
  })

  test('emits prioritized scalar commands using execution-principal cooldown identity', async () => {
    const candidate = dueResource('1404328063')
    plannerMocks.selectDue.mockResolvedValue([candidate])
    const subject = context()

    await expect(runResourcePlanner(subject, { resources: [resource] })).resolves.toMatchObject({
      selected: 1,
      planned: 1,
      reason: 'scheduled',
    })

    expect(plannerMocks.getCooldowns).toHaveBeenCalledWith([
      { operation: 'skills', principal: 'character-1404328063' },
    ])
    expect(subject.producer.commands).toEqual([
      {
        name: 'resource-refresh',
        payload: candidate.identity,
        source: 'planner',
        materializationIntervalSeconds: 900,
      },
    ])
  })

  test('stops at the first cooldown and leaves the suffix due', async () => {
    const candidates = [dueResource('1404328063'), dueResource('1404328064')]
    plannerMocks.selectDue.mockResolvedValue(candidates)
    plannerMocks.getCooldowns.mockResolvedValueOnce([
      { active: false, retryAfterSeconds: null, coordinationAvailable: true },
      { active: true, retryAfterSeconds: 12, coordinationAvailable: true },
    ])
    const subject = context()

    await expect(runResourcePlanner(subject, { resources: [resource] })).resolves.toMatchObject({
      selected: 2,
      planned: 1,
      reason: 'cooldown',
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
    ).resolves.toMatchObject({ selected: 2, planned: 1, reason: 'scheduled' })
    const command = subject.producer.commands[0]
    expect(command).toMatchObject({
      name: 'resource-batch',
      source: 'planner',
      materializationIntervalSeconds: 900,
    })
    if (command?.name !== 'resource-batch') throw new Error('Expected a resource batch command')
    expect(command.payload.subjects.map(({ subjectId }) => subjectId)).toEqual([
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
    producer: createInMemoryQueueProducer({ depth: options.depth }),
    outcomes: {
      recordAffiliation: vi.fn().mockResolvedValue(undefined),
      recordOutbox: vi.fn().mockResolvedValue(undefined),
    },
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
      subjectKind: descriptor.subjectKind,
      subjectLifecycleId: '6f80b8de-8ff0-4dc6-af2c-9fb5c892174a',
      subjectId,
    },
    operationId: descriptor.operationId as 'skills',
  }
}
