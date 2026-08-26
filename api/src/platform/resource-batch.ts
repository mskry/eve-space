import type {
  PlatformCharacterResourceSubject,
  PlatformCompleteObservationBatchOutcome,
  PlatformInstalledResourceDescriptor,
  PlatformResourceBatchMode,
  PlatformResourceBatchOperationImplementation,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type { Queue } from 'bullmq'
import {
  assertRegisteredEsiOperation,
  getEsiOperationContract,
  getExecutableEsiOperationDefinition,
  type EsiOperation,
} from '../esi-resilience/catalog.js'
import { getEsiResilienceLayer, type PublicEsiOperation } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import {
  dispatchModuleEsiOperation,
  validateModuleEsiOperationInputs,
} from '../esi-resilience/module-operation-dispatcher.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import { getQueueAdmissionCapacity, QueueAdmissionError } from '../queue/admission.js'
import {
  getJobDefinition,
  jobOptions,
  platformResourceBatchJobPayloadSchema,
  type JobDefinition,
  type PlatformResourceBatchJobPayload,
} from '../queue/job-registry.js'
import { resourceRefreshPriority } from '../queue/policy.js'
import { findInstalledResource } from './resource-declarations.js'
import { resolveInstalledResourceEligibility } from './resource-eligibility.js'
import { applyInstalledResourceObservation } from './resource-refresh.js'
import {
  assertPlatformResourceRefreshSucceeded,
  PlatformResourceMappingError,
  PlatformResourcePersistenceError,
  recordInstalledResourceCollectionFailure,
} from './resource-failures.js'

type BatchClassification<Data = unknown> =
  | PlatformCompleteObservationBatchOutcome<Data>
  | {
      readonly subject: PlatformCharacterResourceSubject
      readonly outcome: 'changed'
    }

interface EligibleBatchSubject {
  readonly identity: {
    readonly moduleId: string
    readonly resourceId: string
    readonly subjectKind: 'character'
    readonly subjectLifecycleId: string
    readonly subjectId: string
  }
  readonly subject: PlatformCharacterResourceSubject
  readonly authorizationGeneration: number | null
}

type BatchExecution =
  | { readonly outcome: 'noop'; readonly reason: 'resource-unavailable' | 'no-due-subjects' }
  | {
      readonly outcome: 'loaded'
      readonly resource: PlatformInstalledResourceDescriptor
      readonly validatedAt: string
      readonly classifications: readonly (BatchClassification & EligibleBatchSubject)[]
    }

class PlatformResourceBatchExecutionError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempted: readonly EligibleBatchSubject[],
  ) {
    super('Platform resource batch execution failed', { cause })
    this.name = 'PlatformResourceBatchExecutionError'
  }
}

interface BatchExecutionOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
  readonly resilience?: Pick<ReturnType<typeof getEsiResilienceLayer>, 'getPublic'>
  readonly createTransport?: typeof createEsiTransport
  readonly definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>
  readonly validateInputs?: typeof validateModuleEsiOperationInputs
  readonly dispatchOperation?: typeof dispatchModuleEsiOperation
}

interface BatchProcessingOptions extends BatchExecutionOptions {
  readonly executeBatch?: typeof executeInstalledResourceBatchOperation
  readonly applyObservation?: typeof applyInstalledResourceObservation
  readonly getCapacity?: typeof getQueueAdmissionCapacity
  readonly recordFailure?: typeof recordInstalledResourceCollectionFailure
}

async function executeInstalledResourceBatchOperation(
  payload: PlatformResourceBatchJobPayload,
  options: BatchExecutionOptions = {},
): Promise<BatchExecution> {
  const parsed = platformResourceBatchJobPayloadSchema.parse(payload)
  const resources = options.resources ?? installedModuleResources
  const resource = findInstalledResource(parsed, resources)
  if (!resource?.batch) return { outcome: 'noop', reason: 'resource-unavailable' }

  const implementation = resource.implementation as PlatformResourceOperationImplementation
  const batch = implementation.batch as PlatformResourceBatchOperationImplementation | undefined
  if (!batch)
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} lacks batch implementation`,
    )

  assertRegisteredEsiOperation(resource.batch.operationId)
  const operation = resource.batch.operationId as EsiOperation
  const definition = getExecutableEsiOperationDefinition(operation, options.definitions)
  const contract = getEsiOperationContract(operation)
  if (contract.authorization.kind !== 'public' || contract.identity.kind !== 'set')
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} has invalid batch operation policy`,
    )
  if (parsed.subjects.length > contract.identity.maximumItems)
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch exceeds ${contract.identity.maximumItems} subjects`,
    )

  const candidates = parsed.subjects.map((identity) => toEligibleBatchSubject(parsed, identity))
  assertUniqueBatchSubjects(candidates.map(({ subject }) => subject))
  const eligibility = await Promise.all(
    candidates.map(({ identity }) =>
      (options.resolveEligibility ?? resolveInstalledResourceEligibility)(identity, { resources }),
    ),
  )
  const eligible = candidates.flatMap((candidate, index) => {
    const resolved = eligibility[index]
    return resolved?.status === 'eligible' && resolved.due
      ? [{ ...candidate, authorizationGeneration: resolved.authorizationGeneration }]
      : []
  })
  if (eligible.length === 0) return { outcome: 'noop', reason: 'no-due-subjects' }

  const subjects = eligible.map(({ subject }) => subject)
  let inputs: Readonly<Record<string, unknown>>
  try {
    inputs = (options.validateInputs ?? validateModuleEsiOperationInputs)(
      definition,
      batch.request(subjects),
    )
    assertBatchInputs(inputs, contract.identity.field, subjects, contract.identity.maximumItems)
  } catch (error) {
    throw new PlatformResourceBatchExecutionError(new PlatformResourceMappingError(error), eligible)
  }
  let result: Awaited<ReturnType<ReturnType<typeof getEsiResilienceLayer>['getPublic']>>
  try {
    result = await (options.resilience ?? getEsiResilienceLayer()).getPublic({
      operation: operation as PublicEsiOperation,
      inputs,
      load: (revalidation) =>
        (options.dispatchOperation ?? dispatchModuleEsiOperation)(definition, {
          inputs,
          authorization: { kind: 'public' },
          revalidation,
          transport: (options.createTransport ?? createEsiTransport)(operation),
        }),
    })
    assertPlatformResourceRefreshSucceeded(result)
  } catch (error) {
    throw new PlatformResourceBatchExecutionError(error, eligible)
  }
  let classifications: readonly BatchClassification[]
  try {
    classifications = validatePlatformResourceBatchClassifications(
      resource.batch.mode,
      subjects,
      batch.classify({ subjects, data: result.data }),
    )
  } catch (error) {
    throw new PlatformResourceBatchExecutionError(new PlatformResourceMappingError(error), eligible)
  }
  const eligibleBySubject = new Map(
    eligible.map((candidate) => [batchSubjectKey(candidate.subject), candidate]),
  )

  return {
    outcome: 'loaded',
    resource,
    validatedAt: result.validatedAt,
    classifications: classifications.map((classification) => {
      const eligibleSubject = eligibleBySubject.get(batchSubjectKey(classification.subject))
      if (!eligibleSubject) throw new Error('Resource batch classification is not eligible')
      return Object.assign({}, eligibleSubject, classification)
    }),
  }
}

export async function processInstalledResourceBatch(
  payload: PlatformResourceBatchJobPayload,
  queue: Queue,
  options: BatchProcessingOptions = {},
) {
  let execution: Awaited<ReturnType<typeof executeInstalledResourceBatchOperation>>
  try {
    execution = await (options.executeBatch ?? executeInstalledResourceBatchOperation)(
      payload,
      options,
    )
  } catch (error) {
    const failure = error instanceof PlatformResourceBatchExecutionError ? error.cause : error
    const attempted = error instanceof PlatformResourceBatchExecutionError ? error.attempted : []
    await Promise.all(
      attempted.map(({ identity }) =>
        (options.recordFailure ?? recordInstalledResourceCollectionFailure)(identity, failure, {
          resources: options.resources,
        }),
      ),
    )
    throw failure
  }
  if (execution.outcome === 'noop') return

  const changed = [] as EligibleBatchSubject[]
  for (const classification of execution.classifications) {
    if (classification.outcome === 'changed') {
      changed.push(classification)
      continue
    }
    try {
      // oxlint-disable-next-line no-await-in-loop
      await (options.applyObservation ?? applyInstalledResourceObservation)({
        identity: classification.identity,
        resource: execution.resource,
        subject: classification.subject,
        authorizationGeneration: classification.authorizationGeneration,
        validatedAt: execution.validatedAt,
        ...(classification.outcome === 'complete'
          ? { outcome: 'complete', data: classification.data }
          : { outcome: 'unchanged' }),
      })
    } catch (error) {
      const failure = new PlatformResourcePersistenceError(error)
      // oxlint-disable-next-line no-await-in-loop
      await (options.recordFailure ?? recordInstalledResourceCollectionFailure)(
        classification.identity,
        failure,
        { resources: options.resources },
      )
      throw failure
    }
  }

  if (changed.length === 0) return
  let admission: Awaited<ReturnType<typeof getQueueAdmissionCapacity>>
  try {
    admission = await (options.getCapacity ?? getQueueAdmissionCapacity)(queue, 'on-demand')
  } catch (error) {
    if (error instanceof QueueAdmissionError) return
    throw error
  }
  const definition = getJobDefinition('resource-refresh') as JobDefinition<
    EligibleBatchSubject['identity']
  >
  for (const subject of changed.slice(0, admission.remainingCapacity)) {
    // oxlint-disable-next-line no-await-in-loop
    await queue.add(definition.name, subject.identity, {
      ...jobOptions(definition),
      deduplication: { id: definition.operationIdentity(subject.identity) },
      priority: resourceRefreshPriority(execution.resource.materializationIntervalSeconds),
    })
  }
}

export function validatePlatformResourceBatchClassifications<Data>(
  mode: PlatformResourceBatchMode,
  subjects: readonly PlatformCharacterResourceSubject[],
  classifications: unknown,
): readonly BatchClassification<Data>[] {
  assertUniqueBatchSubjects(subjects)
  if (!Array.isArray(classifications))
    throw new Error('Resource batch classification must be an array')

  const requested = new Map(subjects.map((subject) => [batchSubjectKey(subject), subject]))
  const classified = new Map<string, BatchClassification<Data>>()
  for (const value of classifications) {
    if (!isRecord(value) || !isCharacterSubject(value.subject) || typeof value.outcome !== 'string')
      throw new Error('Resource batch classification is invalid')
    const key = batchSubjectKey(value.subject)
    if (!requested.has(key))
      throw new Error('Resource batch classification contains an unknown subject')
    if (classified.has(key))
      throw new Error('Resource batch classification contains a duplicate subject')
    if (mode === 'complete-observation') {
      if (value.outcome !== 'complete' && value.outcome !== 'unchanged')
        throw new Error(`Complete-observation batch cannot classify ${value.outcome}`)
      if (value.outcome === 'complete' && !Object.hasOwn(value, 'data'))
        throw new Error('Complete resource batch classification must carry data')
    } else if (value.outcome !== 'changed' && value.outcome !== 'unchanged')
      throw new Error(`Change-hint batch cannot classify ${value.outcome}`)
    classified.set(key, value as BatchClassification<Data>)
  }
  if (classified.size !== requested.size)
    throw new Error('Resource batch classification omitted a requested subject')
  return subjects.map((subject) => classified.get(batchSubjectKey(subject))!)
}

function toEligibleBatchSubject(
  payload: PlatformResourceBatchJobPayload,
  subjectIdentity: PlatformResourceBatchJobPayload['subjects'][number],
): Omit<EligibleBatchSubject, 'authorizationGeneration'> {
  const characterId = Number(subjectIdentity.subjectId)
  if (!Number.isSafeInteger(characterId) || characterId <= 0)
    throw new Error('Resource batch subject character identity is invalid')
  return {
    identity: {
      moduleId: payload.moduleId,
      resourceId: payload.resourceId,
      subjectKind: payload.subjectKind,
      ...subjectIdentity,
    },
    subject: {
      kind: 'character',
      characterId,
      lifecycleId: subjectIdentity.subjectLifecycleId,
    },
  }
}

function assertBatchInputs(
  inputs: Readonly<Record<string, unknown>>,
  field: string,
  subjects: readonly PlatformCharacterResourceSubject[],
  maximumItems: number,
) {
  const values = inputs[field]
  if (!Array.isArray(values) || values.length !== subjects.length || values.length > maximumItems)
    throw new Error(`Resource batch identity input ${field} must correlate every requested subject`)
  const requested = new Set(subjects.map(({ characterId }) => characterId))
  if (
    values.some((value) => !Number.isSafeInteger(value) || !requested.has(Number(value))) ||
    new Set(values).size !== requested.size
  )
    throw new Error(`Resource batch identity input ${field} must match requested character IDs`)
}

function assertUniqueBatchSubjects(subjects: readonly PlatformCharacterResourceSubject[]) {
  const identities = new Set<string>()
  const characterIds = new Set<number>()
  for (const subject of subjects) {
    const identity = batchSubjectKey(subject)
    if (identities.has(identity) || characterIds.has(subject.characterId))
      throw new Error('Resource batch contains a duplicate subject')
    identities.add(identity)
    characterIds.add(subject.characterId)
  }
}

function batchSubjectKey(subject: PlatformCharacterResourceSubject) {
  return `${subject.characterId}\0${subject.lifecycleId}`
}

function isCharacterSubject(value: unknown): value is PlatformCharacterResourceSubject {
  return (
    isRecord(value) &&
    value.kind === 'character' &&
    Number.isSafeInteger(value.characterId) &&
    Number(value.characterId) > 0 &&
    typeof value.lifecycleId === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
