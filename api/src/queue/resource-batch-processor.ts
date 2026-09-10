import {
  executeInstalledResourceBatchOperation,
  PlatformResourceBatchExecutionError,
  type BatchExecutionOptions,
  type EligibleBatchSubject,
} from '../platform/resource-batch.js'
import { applyInstalledResourceObservation } from '../platform/resource-refresh.js'
import {
  PlatformResourcePersistenceError,
  recordInstalledResourceCollectionFailure,
} from '../platform/resource-failures.js'
import type { JobPayloadByName } from './job-contracts.js'
import type { QueueProducer } from './producer.js'

type PlatformResourceBatchJobPayload = JobPayloadByName['resource-batch']

type LoadedBatchExecution = Extract<
  Awaited<ReturnType<typeof executeInstalledResourceBatchOperation>>,
  { readonly outcome: 'loaded' }
>

export async function processInstalledResourceBatch(
  payload: PlatformResourceBatchJobPayload,
  producer: QueueProducer,
  signal?: AbortSignal,
  options: BatchExecutionOptions = {},
) {
  let execution: Awaited<ReturnType<typeof executeInstalledResourceBatchOperation>>
  try {
    execution = await executeInstalledResourceBatchOperation(payload, options)
  } catch (error) {
    const failure = error instanceof PlatformResourceBatchExecutionError ? error.cause : error
    const attempted = error instanceof PlatformResourceBatchExecutionError ? error.attempted : []
    await Promise.all(
      attempted.map(({ identity }) =>
        recordInstalledResourceCollectionFailure(identity, failure, {
          resources: options.resources,
        }),
      ),
    )
    throw failure
  }
  if (execution.outcome === 'noop') return

  const changed = await applyBatchClassifications(execution, options)
  if (changed.length === 0) return

  await producer.enqueueMany(
    changed.map((subject) => ({
      name: 'resource-refresh',
      payload: subject.identity,
      source: 'on-demand',
      materializationIntervalSeconds: execution.resource.materializationIntervalSeconds,
    })),
    { signal },
  )
}

async function applyBatchClassifications(
  execution: LoadedBatchExecution,
  options: BatchExecutionOptions,
) {
  const changed = [] as EligibleBatchSubject[]
  for (const classification of execution.classifications) {
    if (classification.outcome === 'changed') {
      changed.push(classification)
      continue
    }
    try {
      // oxlint-disable-next-line no-await-in-loop
      await applyInstalledResourceObservation({
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
      await recordInstalledResourceCollectionFailure(classification.identity, failure, {
        resources: options.resources,
      })
      throw failure
    }
  }
  return changed
}
