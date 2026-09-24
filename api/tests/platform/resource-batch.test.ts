import {
  definePlatformSingleRequestResource,
  type PlatformCharacterResourceSubject,
  type PlatformInstalledResourceDescriptor,
  type PlatformResourceImplementation,
  type PlatformResourceOperationContract,
} from '@eve-space/platform-module-contract/resources'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformEsiRequestError } from '../../src/esi-gateway/platform-execution.js'
import {
  executeInstalledResourceBatchOperation,
  validatePlatformResourceBatchClassifications,
} from '../../src/platform/resource-batch.js'
import { processInstalledResourceBatch } from '../../src/queue/resource-batch-processor.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const processorMocks = vi.hoisted(() => ({
  applyObservation: vi.fn(),
  recordFailure: vi.fn(),
}))

vi.mock('../../src/platform/resource-refresh.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/platform/resource-refresh.js')>()),
  applyInstalledResourceObservation: processorMocks.applyObservation,
}))
vi.mock('../../src/platform/resource-failures.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/platform/resource-failures.js')>()),
  recordInstalledResourceCollectionFailure: processorMocks.recordFailure,
}))

const lifecycleIds = [
  '35acd527-9539-44ad-aacf-9f8e45232267',
  '98a782d2-e042-47d7-9659-03b218121a1a',
  '6f80b8de-8ff0-4dc6-af2c-9fb5c892174a',
] as const

beforeEach(() => {
  processorMocks.applyObservation.mockReset().mockResolvedValue(undefined)
  processorMocks.recordFailure.mockReset().mockResolvedValue(undefined)
})

describe('platform resource batch processing', () => {
  test('infers typed scalar and batch response data through the contract helper', () => {
    const typed = definePlatformSingleRequestResource<
      'typed-detail',
      {
        readonly 'typed-detail': PlatformResourceOperationContract<
          { readonly characterId: number },
          { readonly score: number }
        >
      },
      { readonly score: number },
      'typed-batch',
      { readonly changedCharacterIds: number[] }
    >({
      batch: {
        classify: ({ subjects, data }) =>
          subjects.map((batchSubject) => ({
            subject: batchSubject,
            outcome: data.changedCharacterIds.includes(batchSubject.characterId)
              ? ('changed' as const)
              : ('unchanged' as const),
          })),
        mode: 'change-hint',
        operation: 'typed-batch',
        request: (subjects) => ({ ids: subjects.map(({ characterId }) => characterId) }),
      },
      map: ({ data }) => data,
      materialize: async ({ data }) => {
        expect(data.score).toBe(10)
      },
      mode: 'single-request',
      operation: 'typed-detail',
      request: ({ characterId }) => ({ characterId }),
    })

    expect(typed.batch?.mode).toBe('change-hint')
  })

  test('rejects unknown, duplicate, omitted, and mode-invalid classifications', () => {
    const subjects = [subject(0), subject(1)]

    expect(() =>
      validatePlatformResourceBatchClassifications('complete-observation', subjects, [
        { data: 1, outcome: 'complete', subject: subjects[0] },
      ]),
    ).toThrow('omitted a requested subject')
    expect(() =>
      validatePlatformResourceBatchClassifications('complete-observation', subjects, [
        { outcome: 'unchanged', subject: subjects[0] },
        { outcome: 'unchanged', subject: subjects[0] },
      ]),
    ).toThrow('duplicate subject')
    expect(() =>
      validatePlatformResourceBatchClassifications('change-hint', subjects, [
        { outcome: 'unchanged', subject: subjects[0] },
        { outcome: 'changed', subject: subject(2) },
      ]),
    ).toThrow('unknown subject')
    expect(() =>
      validatePlatformResourceBatchClassifications('change-hint', subjects, [
        { data: 1, outcome: 'complete', subject: subjects[0] },
        { outcome: 'unchanged', subject: subjects[1] },
      ]),
    ).toThrow('Change-hint batch cannot classify complete')
    expect(() =>
      validatePlatformResourceBatchClassifications('complete-observation', subjects, [
        { outcome: 'changed', subject: subjects[0] },
        { outcome: 'unchanged', subject: subjects[1] },
      ]),
    ).toThrow('Complete-observation batch cannot classify changed')
    expect(() =>
      validatePlatformResourceBatchClassifications('complete-observation', subjects, [
        { outcome: 'complete', subject: subjects[0] },
        { outcome: 'unchanged', subject: subjects[1] },
      ]),
    ).toThrow('Complete resource batch classification must carry data')
  })

  test('materializes complete observations locally without scalar ESI loads', async () => {
    const resource = completeResource()
    const payload = batchPayload(2)
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution({ observed: true }))
    const queue = batchQueue()

    await processInstalledResourceBatch(payload, queue, undefined, {
      executeEsiOperation,
      resolveEligibility: eligible as never,
      resources: [resource],
    })

    expect(executeEsiOperation).toHaveBeenCalledOnce()
    expect(executeEsiOperation).toHaveBeenCalledWith({
      authorization: { kind: 'public' },
      inputs: { ids: [1_404_328_063, 1_404_328_064] },
      operation: 'universe-resolve-names',
    })
    expect(resource.implementation.batch.classify).toHaveBeenCalledWith({
      data: { observed: true },
      subjects: [subject(0), subject(1)],
    })
    expect(resource.implementation.map).not.toHaveBeenCalled()
    expect(processorMocks.applyObservation).toHaveBeenCalledWith(
      expect.objectContaining({ data: { score: 10 }, outcome: 'complete' }),
    )
    expect(processorMocks.applyObservation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'unchanged' }),
    )
    expect(queue.commands).toHaveLength(0)
  })

  test('rejects batch inputs that do not match the requested characters', async () => {
    const resource = completeResource()
    const payload = batchPayload(2)
    resource.implementation.batch.request.mockReturnValue({ ids: [1, 2] })
    const executeEsiOperation = vi.fn()

    await expect(
      processInstalledResourceBatch(payload, batchQueue(), undefined, {
        executeEsiOperation,
        resolveEligibility: eligible as never,
        resources: [resource],
      }),
    ).rejects.toThrow('Platform resource mapping failed')
    expect(executeEsiOperation).not.toHaveBeenCalled()
    expect(processorMocks.recordFailure).toHaveBeenCalledTimes(2)
  })

  test('rejects a batch above the ESI operation limit before eligibility or execution', async () => {
    const resolveEligibility = vi.fn()
    const executeEsiOperation = vi.fn()

    await expect(
      executeInstalledResourceBatchOperation(oversizedBatchPayload(), {
        executeEsiOperation,
        resolveEligibility,
        resources: [completeResource()],
      }),
    ).rejects.toThrow('batch exceeds 1000 subjects')
    expect(resolveEligibility).not.toHaveBeenCalled()
    expect(executeEsiOperation).not.toHaveBeenCalled()
  })

  test('rejects caller-owned conditional headers before consulting the batch cache', async () => {
    const resource = completeResource()
    const payload = batchPayload(2)
    const executeEsiOperation = vi
      .fn()
      .mockRejectedValue(new PlatformEsiRequestError('Platform ESI request inputs are invalid'))

    await expect(
      processInstalledResourceBatch(payload, batchQueue(), undefined, {
        executeEsiOperation,
        resolveEligibility: eligible as never,
        resources: [resource],
      }),
    ).rejects.toThrow('Platform resource mapping failed')
    expect(executeEsiOperation).toHaveBeenCalledOnce()
  })

  test('records a batch failure only for subjects included in the attempted request', async () => {
    const payload = batchPayload(2)
    const failure = new Error('ESI unavailable')

    await expect(
      processInstalledResourceBatch(payload, batchQueue(), undefined, {
        executeEsiOperation: vi.fn().mockRejectedValue(failure),
        resolveEligibility: vi
          .fn()
          .mockResolvedValueOnce({
            status: 'eligible',
            due: true,
            authorizationGeneration: 4,
            managedAuthority: null,
            nextEligibleAt: null,
          })
          .mockResolvedValueOnce({ status: 'eligible', due: false }),
        resources: [completeResource()],
      }),
    ).rejects.toBe(failure)

    expect(processorMocks.recordFailure).toHaveBeenCalledOnce()
    expect(processorMocks.recordFailure).toHaveBeenCalledWith(identity(payload, 0), failure, {
      expectedAuthorizationGeneration: 4,
      expectedManagedAuthority: null,
      resources: expect.any(Array),
    })
  })

  test('does not record subject failures when batch execution is cancelled', async () => {
    const controller = new AbortController()
    const executeEsiOperation = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw controller.signal.reason
    })

    const pending = processInstalledResourceBatch(
      batchPayload(2),
      batchQueue(),
      controller.signal,
      {
        executeEsiOperation,
        resolveEligibility: eligible as never,
        resources: [completeResource()],
      },
    )
    const rejected = pending.catch((error: unknown) => error)
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(true))

    await expect(rejected).resolves.toBe(controller.signal.reason)
    expect(processorMocks.recordFailure).not.toHaveBeenCalled()
  })

  test('admits scalar refreshes only for changed hints and leaves the capacity suffix untouched', async () => {
    const resource = changeHintResource()
    const payload = batchPayload(3)
    const queue = createInMemoryQueueProducer({ highWaterMark: 1 })

    await processInstalledResourceBatch(payload, queue, undefined, {
      executeEsiOperation: vi.fn().mockResolvedValue(platformExecution({ observed: true })),
      resolveEligibility: eligible as never,
      resources: [resource],
    })

    expect(processorMocks.applyObservation).toHaveBeenCalledOnce()
    expect(processorMocks.applyObservation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'unchanged' }),
    )
    const firstIdentity = identity(payload, 0)
    expect(queue.commands).toStrictEqual([
      {
        materializationIntervalSeconds: 900,
        name: 'resource-refresh',
        payload: firstIdentity,
        source: 'on-demand',
      },
    ])
    expect(resource.implementation.map).not.toHaveBeenCalled()
  })
})

function completeResource() {
  const implementation = baseImplementation({
    classify: vi.fn(({ subjects }: { subjects: readonly PlatformCharacterResourceSubject[] }) => [
      { subject: subjects[0]!, outcome: 'complete' as const, data: { score: 10 } },
      { subject: subjects[1]!, outcome: 'unchanged' as const },
    ]),
    mode: 'complete-observation',
  })
  return descriptor('complete-observation', implementation)
}

function changeHintResource() {
  const implementation = baseImplementation({
    classify: vi.fn(({ subjects }: { subjects: readonly PlatformCharacterResourceSubject[] }) => [
      { subject: subjects[0]!, outcome: 'changed' as const },
      { subject: subjects[1]!, outcome: 'changed' as const },
      { subject: subjects[2]!, outcome: 'unchanged' as const },
    ]),
    mode: 'change-hint',
  })
  return descriptor('change-hint', implementation)
}

function baseImplementation(batch: {
  readonly mode: 'complete-observation' | 'change-hint'
  readonly classify: ReturnType<typeof vi.fn>
}) {
  return {
    batch: {
      classify: batch.classify,
      mode: batch.mode,
      operation: 'universe-resolve-names',
      request: vi.fn((subjects: readonly PlatformCharacterResourceSubject[]) => ({
        ids: subjects.map(({ characterId }) => characterId),
      })),
    },
    map: vi.fn(),
    materialize: vi.fn(),
    mode: 'single-request' as const,
    operation: 'skills',
    request: vi.fn(),
  }
}

function descriptor(
  mode: 'complete-observation' | 'change-hint',
  implementation: ReturnType<typeof baseImplementation>,
) {
  return {
    batch: { mode, operationId: 'universe-resolve-names' },
    eligibility: { kind: 'current-owned-character' },
    implementation,
    materializationIntervalSeconds: 900,
    moduleId: 'member-audit',
    operationId: 'skills',
    resourceId: 'trained-skills',
    subjectKind: 'character',
  } as PlatformInstalledResourceDescriptor<PlatformResourceImplementation> & {
    readonly implementation: typeof implementation
  }
}

function batchPayload(count: number) {
  return {
    moduleId: 'member-audit',
    resourceId: 'trained-skills',
    subjectKind: 'character' as const,
    subjects: lifecycleIds.slice(0, count).map((subjectLifecycleId, index) => ({
      subjectId: String(1_404_328_063 + index),
      subjectLifecycleId,
    })),
  }
}

function oversizedBatchPayload() {
  return {
    moduleId: 'member-audit',
    resourceId: 'trained-skills',
    subjectKind: 'character' as const,
    subjects: Array.from({ length: 1001 }, (_, index) => ({
      subjectId: String(1_404_328_063 + index),
      subjectLifecycleId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    })),
  }
}

function subject(index: number): PlatformCharacterResourceSubject {
  return {
    characterId: 1_404_328_063 + index,
    kind: 'character',
    lifecycleId: lifecycleIds[index]!,
  }
}

function identity(payload: ReturnType<typeof batchPayload>, index: number) {
  return {
    moduleId: payload.moduleId,
    resourceId: payload.resourceId,
    subjectKind: payload.subjectKind,
    ...payload.subjects[index]!,
  }
}

function eligible() {
  return Promise.resolve({
    authorizationGeneration: 4,
    due: true,
    nextEligibleAt: null,
    status: 'eligible' as const,
  })
}

function platformExecution(data: unknown) {
  return {
    authorizationGeneration: null,
    cachedUntil: '2026-08-26T15:00:00.000Z',
    data,
    quota: {},
    source: 'esi' as const,
    stale: false,
    validatedAt: '2026-08-26T14:58:00.000Z',
  }
}

function batchQueue() {
  return createInMemoryQueueProducer()
}
