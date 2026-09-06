import type {
  PlatformCharacterResourceSubject,
  PlatformCompleteObservationBatchOutcome,
  PlatformInstalledResourceDescriptor,
  PlatformResourceBatchMode,
  PlatformResourceBatchOperationImplementation,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import {
  assertRegisteredEsiOperation,
  getEsiOperationContract,
  getExecutableEsiOperationDefinition,
} from '../esi-resilience/catalog-access.js'
import type { EsiOperation } from '../esi-resilience/catalog.js'
import { getEsiResilienceLayer, type PublicEsiOperation } from '../esi-resilience/layer.js'
import { createEsiTransport } from '../esi-resilience/request-transport.js'
import {
  dispatchModuleEsiOperation,
  validateModuleEsiOperationInputs,
} from '../esi-resilience/module-operation-dispatcher.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import { isPositiveSafeInteger, isRecord } from '../type-guards.js'
import {
  platformResourceBatchPayloadSchema,
  type PlatformResourceBatchPayload,
} from './resource-batch-contract.js'
import { resolveInstalledResourceEligibility } from './resource-eligibility.js'
import { findInstalledResource } from './resource-identity.js'
import {
  assertPlatformResourceRefreshSucceeded,
  PlatformResourceMappingError,
} from './resource-failures.js'

type BatchClassification<Data = unknown> =
  | PlatformCompleteObservationBatchOutcome<Data>
  | {
      readonly subject: PlatformCharacterResourceSubject
      readonly outcome: 'changed'
    }

export interface EligibleBatchSubject {
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

export type BatchExecution =
  | { readonly outcome: 'noop'; readonly reason: 'resource-unavailable' | 'no-due-subjects' }
  | {
      readonly outcome: 'loaded'
      readonly resource: PlatformInstalledResourceDescriptor
      readonly validatedAt: string
      readonly classifications: readonly (BatchClassification & EligibleBatchSubject)[]
    }
export class PlatformResourceBatchExecutionError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempted: readonly EligibleBatchSubject[],
  ) {
    super('Platform resource batch execution failed', { cause })
    this.name = 'PlatformResourceBatchExecutionError'
  }
}

export interface BatchExecutionOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
  readonly resilience?: Pick<ReturnType<typeof getEsiResilienceLayer>, 'getPublic'>
  readonly createTransport?: typeof createEsiTransport
  readonly definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>
  readonly validateInputs?: typeof validateModuleEsiOperationInputs
  readonly dispatchOperation?: typeof dispatchModuleEsiOperation
}

export async function executeInstalledResourceBatchOperation(
  payload: PlatformResourceBatchPayload,
  options: BatchExecutionOptions = {},
): Promise<BatchExecution> {
  const parsed = platformResourceBatchPayloadSchema.parse(payload)
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
  const enrichClassification = (classification: (typeof classifications)[number]) => {
    const eligibleSubject = eligibleBySubject.get(batchSubjectKey(classification.subject))
    if (!eligibleSubject) throw new Error('Resource batch classification is not eligible')
    return { ...eligibleSubject, ...classification }
  }

  return {
    outcome: 'loaded',
    resource,
    validatedAt: result.validatedAt,
    classifications: classifications.map(enrichClassification),
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
    const [key, classification] = validateBatchClassification<Data>(
      mode,
      value,
      requested,
      classified,
    )
    classified.set(key, classification)
  }
  if (classified.size !== requested.size)
    throw new Error('Resource batch classification omitted a requested subject')
  return subjects.map((subject) => classified.get(batchSubjectKey(subject))!)
}

function validateBatchClassification<Data>(
  mode: PlatformResourceBatchMode,
  value: unknown,
  requested: ReadonlyMap<string, PlatformCharacterResourceSubject>,
  classified: ReadonlyMap<string, BatchClassification<Data>>,
): readonly [string, BatchClassification<Data>] {
  if (!isRecord(value) || !isCharacterSubject(value.subject) || typeof value.outcome !== 'string')
    throw new Error('Resource batch classification is invalid')

  const key = batchSubjectKey(value.subject)
  if (!requested.has(key))
    throw new Error('Resource batch classification contains an unknown subject')
  if (classified.has(key))
    throw new Error('Resource batch classification contains a duplicate subject')

  assertBatchClassificationOutcome(mode, value, value.outcome)
  return [key, value as BatchClassification<Data>]
}

function assertBatchClassificationOutcome(
  mode: PlatformResourceBatchMode,
  value: Readonly<Record<string, unknown>>,
  outcome: string,
) {
  if (mode === 'change-hint') {
    if (outcome !== 'changed' && outcome !== 'unchanged')
      throw new Error(`Change-hint batch cannot classify ${outcome}`)
    return
  }
  if (outcome !== 'complete' && outcome !== 'unchanged')
    throw new Error(`Complete-observation batch cannot classify ${outcome}`)
  if (outcome === 'complete' && !Object.hasOwn(value, 'data'))
    throw new Error('Complete resource batch classification must carry data')
}

function toEligibleBatchSubject(
  payload: PlatformResourceBatchPayload,
  subjectIdentity: PlatformResourceBatchPayload['subjects'][number],
): Omit<EligibleBatchSubject, 'authorizationGeneration'> {
  const characterId = Number(subjectIdentity.subjectId)
  if (!isPositiveSafeInteger(characterId))
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
    isPositiveSafeInteger(value.characterId) &&
    typeof value.lifecycleId === 'string'
  )
}
