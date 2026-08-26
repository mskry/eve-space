import {
  definePlatformResourceOperation,
  type PlatformCharacterResourceSubject,
  type PlatformInstalledResourceDescriptor,
  type PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { describe, expect, test, vi } from 'vitest'
import {
  processInstalledResourceBatch,
  validatePlatformResourceBatchClassifications,
} from '../src/platform/resource-batch.js'
import { resourceRefreshJobId } from '../src/queue/job-registry.js'

const lifecycleIds = [
  '35acd527-9539-44ad-aacf-9f8e45232267',
  '98a782d2-e042-47d7-9659-03b218121a1a',
  '6f80b8de-8ff0-4dc6-af2c-9fb5c892174a',
] as const

describe('platform resource batch processing', () => {
  test('infers typed scalar and batch response data through the contract helper', () => {
    const typed = definePlatformResourceOperation({
      operation: 'typed-detail',
      request: ({ characterId }) => ({ characterId }),
      map: ({ data }: { data: { score: number } }) => data,
      materialize: async ({ data }) => {
        expect(data.score).toBe(10)
      },
      batch: {
        mode: 'change-hint',
        operation: 'typed-batch',
        request: (subjects) => ({ ids: subjects.map(({ characterId }) => characterId) }),
        classify: ({
          subjects,
          data,
        }: {
          subjects: readonly PlatformCharacterResourceSubject[]
          data: { changedCharacterIds: number[] }
        }) =>
          subjects.map((batchSubject) => ({
            subject: batchSubject,
            outcome: data.changedCharacterIds.includes(batchSubject.characterId)
              ? ('changed' as const)
              : ('unchanged' as const),
          })),
      },
    })

    expect(typed.batch?.mode).toBe('change-hint')
  })

  test('rejects unknown, duplicate, omitted, and mode-invalid classifications', () => {
    const subjects = [subject(0), subject(1)]

    expect(() =>
      validatePlatformResourceBatchClassifications('complete-observation', subjects, [
        { subject: subjects[0], outcome: 'complete', data: 1 },
      ]),
    ).toThrow('omitted a requested subject')
    expect(() =>
      validatePlatformResourceBatchClassifications('complete-observation', subjects, [
        { subject: subjects[0], outcome: 'unchanged' },
        { subject: subjects[0], outcome: 'unchanged' },
      ]),
    ).toThrow('duplicate subject')
    expect(() =>
      validatePlatformResourceBatchClassifications('change-hint', subjects, [
        { subject: subjects[0], outcome: 'unchanged' },
        { subject: subject(2), outcome: 'changed' },
      ]),
    ).toThrow('unknown subject')
    expect(() =>
      validatePlatformResourceBatchClassifications('change-hint', subjects, [
        { subject: subjects[0], outcome: 'complete', data: 1 },
        { subject: subjects[1], outcome: 'unchanged' },
      ]),
    ).toThrow('Change-hint batch cannot classify complete')
  })

  test('materializes complete observations locally without scalar ESI loads', async () => {
    const resource = completeResource()
    const payload = batchPayload(2)
    const applyObservation = vi.fn().mockResolvedValue(undefined)
    const getPublic = batchResilience()
    const definition = batchDefinition()
    const dispatchOperation = vi.fn().mockResolvedValue({
      data: { observed: true },
      meta: { status: 200, headers: {} },
    })
    const queue = batchQueue()

    await processInstalledResourceBatch(payload, queue as never, {
      resources: [resource],
      resolveEligibility: eligible as never,
      resilience: { getPublic: getPublic as never },
      definitions: { 'universe-resolve-names': definition },
      validateInputs: passthroughInputs,
      dispatchOperation,
      createTransport: vi.fn().mockReturnValue(vi.fn()),
      applyObservation: applyObservation as never,
    })

    expect(getPublic).toHaveBeenCalledOnce()
    expect(dispatchOperation).toHaveBeenCalledOnce()
    expect(resource.implementation.map).not.toHaveBeenCalled()
    expect(applyObservation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: 'complete', data: { score: 10 } }),
    )
    expect(applyObservation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: 'unchanged' }),
    )
    expect(queue.add).not.toHaveBeenCalled()
  })

  test('rejects batch inputs that do not match the requested characters', async () => {
    const resource = completeResource()
    const payload = batchPayload(2)
    resource.implementation.batch.request.mockReturnValue({ ids: [1, 2] })
    const getPublic = batchResilience()
    const recordFailure = vi.fn().mockResolvedValue(undefined)

    await expect(
      processInstalledResourceBatch(payload, batchQueue() as never, {
        resources: [resource],
        resolveEligibility: eligible as never,
        resilience: { getPublic: getPublic as never },
        definitions: { 'universe-resolve-names': batchDefinition() },
        validateInputs: passthroughInputs,
        recordFailure,
      }),
    ).rejects.toThrow('Platform resource mapping failed')
    expect(getPublic).not.toHaveBeenCalled()
    expect(recordFailure).toHaveBeenCalledTimes(2)
  })

  test('admits scalar refreshes only for changed hints and leaves the capacity suffix untouched', async () => {
    const resource = changeHintResource()
    const payload = batchPayload(3)
    const applyObservation = vi.fn().mockResolvedValue(undefined)
    const queue = batchQueue()

    await processInstalledResourceBatch(payload, queue as never, {
      resources: [resource],
      resolveEligibility: eligible as never,
      resilience: { getPublic: batchResilience() as never },
      definitions: { 'universe-resolve-names': batchDefinition() },
      validateInputs: passthroughInputs,
      dispatchOperation: vi.fn().mockResolvedValue({
        data: { observed: true },
        meta: { status: 200, headers: {} },
      }),
      createTransport: vi.fn().mockReturnValue(vi.fn()),
      applyObservation: applyObservation as never,
      getCapacity: vi.fn().mockResolvedValue({
        admitted: true,
        depth: 99,
        remainingCapacity: 1,
      }),
    })

    expect(applyObservation).toHaveBeenCalledOnce()
    expect(applyObservation).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'unchanged' }))
    const firstIdentity = identity(payload, 0)
    expect(queue.add).toHaveBeenCalledOnce()
    expect(queue.add).toHaveBeenCalledWith(
      'resource-refresh',
      firstIdentity,
      expect.objectContaining({
        deduplication: { id: resourceRefreshJobId(firstIdentity) },
        priority: 900,
      }),
    )
    expect(resource.implementation.map).not.toHaveBeenCalled()
  })
})

function completeResource() {
  const implementation = baseImplementation({
    mode: 'complete-observation',
    classify: vi.fn(({ subjects }: { subjects: readonly PlatformCharacterResourceSubject[] }) => [
      { subject: subjects[0]!, outcome: 'complete' as const, data: { score: 10 } },
      { subject: subjects[1]!, outcome: 'unchanged' as const },
    ]),
  })
  return descriptor('complete-observation', implementation)
}

function changeHintResource() {
  const implementation = baseImplementation({
    mode: 'change-hint',
    classify: vi.fn(({ subjects }: { subjects: readonly PlatformCharacterResourceSubject[] }) => [
      { subject: subjects[0]!, outcome: 'changed' as const },
      { subject: subjects[1]!, outcome: 'changed' as const },
      { subject: subjects[2]!, outcome: 'unchanged' as const },
    ]),
  })
  return descriptor('change-hint', implementation)
}

function baseImplementation(batch: {
  readonly mode: 'complete-observation' | 'change-hint'
  readonly classify: ReturnType<typeof vi.fn>
}) {
  return {
    operation: 'skills',
    request: vi.fn(),
    map: vi.fn(),
    materialize: vi.fn(),
    batch: {
      operation: 'universe-resolve-names',
      mode: batch.mode,
      request: vi.fn((subjects: readonly PlatformCharacterResourceSubject[]) => ({
        ids: subjects.map(({ characterId }) => characterId),
      })),
      classify: batch.classify,
    },
  }
}

function descriptor(
  mode: 'complete-observation' | 'change-hint',
  implementation: ReturnType<typeof baseImplementation>,
) {
  return {
    moduleId: 'member-audit',
    resourceId: 'trained-skills',
    operationId: 'skills',
    batch: { mode, operationId: 'universe-resolve-names' },
    subjectKind: 'character',
    materializationIntervalSeconds: 900,
    eligibility: { kind: 'current-owned-character' },
    implementation,
  } as PlatformInstalledResourceDescriptor<PlatformResourceOperationImplementation> & {
    readonly implementation: typeof implementation
  }
}

function batchPayload(count: number) {
  return {
    moduleId: 'member-audit',
    resourceId: 'trained-skills',
    subjectKind: 'character' as const,
    subjects: lifecycleIds.slice(0, count).map((subjectLifecycleId, index) => ({
      subjectLifecycleId,
      subjectId: String(1_404_328_063 + index),
    })),
  }
}

function subject(index: number): PlatformCharacterResourceSubject {
  return {
    kind: 'character',
    characterId: 1_404_328_063 + index,
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
    status: 'eligible' as const,
    due: true,
    authorizationGeneration: 4,
    nextEligibleAt: null,
  })
}

function batchResilience() {
  return vi.fn(async (request: { load(revalidation: object): Promise<{ data: unknown }> }) => {
    const loaded = await request.load({})
    return {
      data: loaded.data,
      cachedUntil: '2026-08-26T15:00:00.000Z',
      validatedAt: '2026-08-26T14:58:00.000Z',
      source: 'esi' as const,
      stale: false,
      quota: {},
    }
  })
}

function batchDefinition() {
  return {
    sdkOperationId: 'PostUniverseNames',
    descriptor: {} as never,
    contract: {} as never,
  } satisfies PlatformExecutableEsiOperationDefinition
}

function passthroughInputs(
  _definition: PlatformExecutableEsiOperationDefinition,
  inputs: Readonly<Record<string, unknown>>,
) {
  return inputs
}

function batchQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) }
}
