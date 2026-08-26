import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { describe, expect, test, vi } from 'vitest'
import { getQueueAdmissionCapacity } from '../src/queue/admission.js'
import { runAffiliationPlanner } from '../src/queue/affiliation-planner.js'
import {
  getJobDefinition,
  jobOptions,
  resourceBatchJobId,
  resourceRefreshJobId,
} from '../src/queue/job-registry.js'
import { derivedResourcePriorityBand, resourceRefreshPriority } from '../src/queue/policy.js'
import { runResourcePlanner } from '../src/queue/resource-planner.js'

const resource = {
  moduleId: 'member-audit',
  resourceId: 'character-skills',
  operationId: 'skills',
  subjectKind: 'character',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation: {},
} as const satisfies PlatformInstalledResourceDescriptor

const fasterResource = {
  ...resource,
  resourceId: 'character-skills-fast',
  materializationIntervalSeconds: 300,
} as const satisfies PlatformInstalledResourceDescriptor

const batchResource = {
  ...resource,
  batch: { mode: 'complete-observation', operationId: 'universe-resolve-names' },
} as const satisfies PlatformInstalledResourceDescriptor

describe('generic resource planner', () => {
  test('is idle without installed resources and touches no external boundary', async () => {
    const subject = queue()
    const dependencies = dependencyMocks()

    await expect(
      runResourcePlanner(subject as never, undefined, { resources: [], dependencies }),
    ).resolves.toEqual({ selected: 0, planned: 0, reason: 'idle' })
    expect(dependencies.getCapacity).not.toHaveBeenCalled()
    expect(dependencies.selectDue).not.toHaveBeenCalled()
    expect(subject.add).not.toHaveBeenCalled()
  })

  test('bounds PostgreSQL selection by remaining high-water capacity', async () => {
    const subject = queue()
    const dependencies = dependencyMocks({ remainingCapacity: 2 })

    await runResourcePlanner(subject as never, undefined, {
      resources: [resource],
      pageSize: 5,
      highWaterMark: 7,
      dependencies,
    })

    expect(dependencies.getCapacity).toHaveBeenCalledWith(subject, 'planner', 7, {
      preservePausedState: true,
    })
    expect(dependencies.selectDue).toHaveBeenCalledWith({ limit: 2, resources: [resource] })
  })

  test('does not query PostgreSQL when queue capacity is exhausted', async () => {
    const dependencies = dependencyMocks({ admitted: false, remainingCapacity: 0 })

    await expect(
      runResourcePlanner(queue() as never, undefined, {
        resources: [resource],
        highWaterMark: 3,
        dependencies,
      }),
    ).resolves.toMatchObject({ selected: 0, planned: 0, reason: 'capacity' })
    expect(dependencies.selectDue).not.toHaveBeenCalled()
  })

  test('preserves an affiliation cooldown pause while inspecting resource capacity', async () => {
    const subject = queue()

    await runAffiliationPlanner(subject as never, undefined, {
      dependencies: { cooldownActive: async () => true },
    })
    await runResourcePlanner(subject as never, undefined, {
      resources: [resource],
      dependencies: { ...dependencyMocks(), getCapacity: getQueueAdmissionCapacity },
    })

    expect(subject.client.set).toHaveBeenCalledWith('eve-space:v1:planner:state', 'paused')
    expect(subject.client.del).not.toHaveBeenCalled()
  })

  test('uses the execution principal and staggered derived-resource job options', async () => {
    const subject = queue()
    const candidate = dueResource('1404328063')
    const dependencies = dependencyMocks({ candidates: [candidate] })

    await expect(
      runResourcePlanner(subject as never, undefined, { resources: [resource], dependencies }),
    ).resolves.toMatchObject({ selected: 1, planned: 1, reason: 'scheduled' })

    expect(dependencies.getCooldowns).toHaveBeenCalledWith({
      connection: subject.client,
      requests: [{ operation: 'skills', principal: 'character-1404328063' }],
    })
    expect(subject.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'resource-refresh',
        data: candidate.identity,
        opts: expect.objectContaining({
          backoff: { type: 'exponential', delay: 1_000, jitter: 0.25 },
          deduplication: { id: resourceRefreshJobId(candidate.identity) },
          delay: 30_000,
          priority: 900,
        }),
      }),
    ])
    const addedOptions = subject.addBulk.mock.calls[0]?.[0][0]?.opts
    expect(addedOptions).not.toHaveProperty('jobId')
  })

  test('reuses one lifecycle-bound simple deduplication identity across planning passes', async () => {
    const subject = queue()
    const candidate = dueResource('1404328063')

    const dependencies = dependencyMocks({ candidates: [candidate] })
    await runResourcePlanner(subject as never, undefined, { resources: [resource], dependencies })
    await runResourcePlanner(subject as never, undefined, { resources: [resource], dependencies })

    const expected = { id: resourceRefreshJobId(candidate.identity) }
    expect(subject.addBulk.mock.calls[0]?.[0][0]?.opts).toEqual(
      expect.objectContaining({ deduplication: expected }),
    )
    expect(subject.addBulk.mock.calls[1]?.[0][0]?.opts).toEqual(
      expect.objectContaining({ deduplication: expected }),
    )
  })

  test('samples first-dispatch staggering independently and orders shorter intervals first', async () => {
    const subject = queue()
    const candidates = [dueResource('1404328063'), dueResource('1404328064', fasterResource)]
    const dependencies = dependencyMocks({ candidates })
    dependencies.getInitialDelay.mockResolvedValueOnce(4_000).mockResolvedValueOnce(11_000)

    await runResourcePlanner(subject as never, undefined, {
      resources: [resource, fasterResource],
      dependencies,
    })

    expect(subject.addBulk.mock.calls[0]?.[0][0]?.opts).toEqual(
      expect.objectContaining({ delay: 4_000, priority: 900 }),
    )
    expect(subject.addBulk.mock.calls[0]?.[0][1]?.opts).toEqual(
      expect.objectContaining({ delay: 11_000, priority: 300 }),
    )
    expect(dependencies.getInitialDelay).toHaveBeenCalledTimes(2)
  })

  test('keeps resource priorities below unprioritized authoritative work', () => {
    expect(resourceRefreshPriority(1)).toBe(derivedResourcePriorityBand.highest)
    expect(resourceRefreshPriority(300)).toBeLessThan(resourceRefreshPriority(900))
    expect(resourceRefreshPriority(derivedResourcePriorityBand.lowest + 1)).toBe(
      derivedResourcePriorityBand.lowest,
    )
    expect(() => resourceRefreshPriority(0)).toThrow('positive safe integer')

    const authoritative = getJobDefinition('domain-event')
    if (!authoritative) throw new Error('Domain-event job definition is missing')
    expect(jobOptions(authoritative)).not.toHaveProperty('priority')
    expect(resourceRefreshPriority(1)).toBeGreaterThan(0)
  })

  test('omits a first-dispatch delay when no schedule window remains', async () => {
    const subject = queue()
    const dependencies = dependencyMocks({ candidates: [dueResource('1404328063')] })
    dependencies.getInitialDelay.mockResolvedValue(0)

    await runResourcePlanner(subject as never, undefined, { resources: [resource], dependencies })

    expect(subject.addBulk.mock.calls[0]?.[0][0]?.opts).not.toHaveProperty('delay')
    expect(subject.addBulk.mock.calls[0]?.[0][0]?.opts).toEqual(
      expect.objectContaining({ priority: 900 }),
    )
  })

  test('stops at the first applicable cooldown and leaves the suffix due', async () => {
    const subject = queue()
    const candidates = [dueResource('1404328063'), dueResource('1404328064')]
    const dependencies = dependencyMocks({ candidates })
    dependencies.getCooldowns.mockResolvedValueOnce([
      {
        active: false,
        retryAfterSeconds: null,
        coordinationAvailable: true,
      },
      { active: true, retryAfterSeconds: 12, coordinationAvailable: true },
    ])

    await expect(
      runResourcePlanner(subject as never, undefined, { resources: [resource], dependencies }),
    ).resolves.toMatchObject({ selected: 2, planned: 1, reason: 'cooldown' })
    expect(subject.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'resource-refresh', data: candidates[0]!.identity }),
    ])
  })

  test('groups a deterministic bounded batch into one non-overlapping derived job', async () => {
    const subject = queue()
    const candidates = [
      dueResource('1404328063', batchResource),
      dueResource('1404328064', batchResource),
      dueResource('1404328065', batchResource),
    ]
    const dependencies = dependencyMocks({ candidates })

    await expect(
      runResourcePlanner(subject as never, undefined, {
        resources: [batchResource],
        pageSize: 50,
        dependencies,
      }),
    ).resolves.toMatchObject({ selected: 3, planned: 1, reason: 'scheduled' })

    expect(dependencies.selectDue).toHaveBeenCalledWith({ limit: 50, resources: [batchResource] })
    expect(dependencies.getCooldowns).toHaveBeenCalledOnce()
    expect(dependencies.getCooldowns).toHaveBeenCalledWith({
      connection: subject.client,
      requests: [{ operation: 'universe-resolve-names' }],
    })
    const payload = {
      moduleId: batchResource.moduleId,
      resourceId: batchResource.resourceId,
      subjectKind: 'character',
      subjects: candidates.map(({ identity }) => ({
        subjectLifecycleId: identity.subjectLifecycleId,
        subjectId: identity.subjectId,
      })),
    } as const
    expect(subject.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'resource-batch',
        data: payload,
        opts: expect.objectContaining({
          deduplication: { id: resourceBatchJobId(payload) },
          delay: 30_000,
          priority: 900,
        }),
      }),
    ])
  })
})

function queue() {
  const client = { marker: 'redis', del: vi.fn(), set: vi.fn() }
  return {
    client,
    add: vi.fn().mockResolvedValue(undefined),
    addBulk: vi.fn().mockResolvedValue(undefined),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, delayed: 0, prioritized: 0 }),
    getBackend: () => ({ client: Promise.resolve(client) }),
  }
}

function dependencyMocks(
  options: {
    admitted?: boolean
    remainingCapacity?: number
    candidates?: ReturnType<typeof dueResource>[]
  } = {},
) {
  const remainingCapacity = options.remainingCapacity ?? 100
  return {
    getCapacity: vi.fn().mockResolvedValue({
      admitted: options.admitted ?? true,
      depth: 0,
      remainingCapacity,
      ...(options.admitted === false ? { reason: 'planner-paused' as const } : {}),
    }),
    selectDue: vi.fn().mockResolvedValue(options.candidates ?? []),
    getCooldowns: vi.fn().mockImplementation(({ requests }) =>
      Promise.resolve(
        requests.map(() => ({
          active: false,
          retryAfterSeconds: null,
          coordinationAvailable: true,
        })),
      ),
    ),
    getInitialDelay: vi.fn().mockResolvedValue(30_000),
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
    operationId: 'skills' as const,
  }
}
