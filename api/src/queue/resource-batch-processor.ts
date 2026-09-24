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
    execution = await executeInstalledResourceBatchOperation(payload, { ...options, signal })
  } catch (error) {
    signal?.throwIfAborted()
    const failure = error instanceof PlatformResourceBatchExecutionError ? error.cause : error
    const attempted = error instanceof PlatformResourceBatchExecutionError ? error.attempted : []
    await Promise.all(
      attempted.map(({ identity, authorizationGeneration, managedAuthority }) =>
        recordInstalledResourceCollectionFailure(identity, failure, {
          expectedAuthorizationGeneration: authorizationGeneration,
          resources: options.resources,
          ...(managedAuthority === undefined ? {} : { expectedManagedAuthority: managedAuthority }),
        }),
      ),
    )
    throw failure
  }
  if (execution.outcome === 'noop') {
    return
  }
  signal?.throwIfAborted()

  const changed = await applyBatchClassifications(execution, options, signal)
  if (changed.length === 0) {
    return
  }

  await producer.enqueueMany(
    changed.map((subject) => ({
      materializationIntervalSeconds: execution.resource.materializationIntervalSeconds,
      name: 'resource-refresh',
      payload: subject.identity,
      source: 'on-demand',
    })),
    { signal },
  )
}

async function applyBatchClassifications(
  execution: LoadedBatchExecution,
  options: BatchExecutionOptions,
  signal?: AbortSignal,
) {
  const changed = [] as EligibleBatchSubject[]
  for (const classification of execution.classifications) {
    signal?.throwIfAborted()
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
        managedAuthority: classification.managedAuthority,
        validatedAt: execution.validatedAt,
        ...(classification.outcome === 'complete'
          ? { data: classification.data, outcome: 'complete' }
          : { outcome: 'unchanged' }),
        signal,
      })
    } catch (error) {
      signal?.throwIfAborted()
      const failure = new PlatformResourcePersistenceError(error)
      // oxlint-disable-next-line no-await-in-loop
      await recordInstalledResourceCollectionFailure(classification.identity, failure, {
        expectedAuthorizationGeneration: classification.authorizationGeneration,
        resources: options.resources,
        ...(classification.managedAuthority === undefined
          ? {}
          : { expectedManagedAuthority: classification.managedAuthority }),
      })
      throw failure
    }
  }
  return changed
}
