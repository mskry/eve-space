import type { Queue } from 'bullmq'
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
import { getQueueAdmissionCapacity, QueueAdmissionError } from './admission.js'
import { jobOptions } from './job-options.js'
import {
  resourceRefreshJobContract,
  type PlatformResourceBatchJobPayload,
} from './resource-job-contracts.js'
import { resourceRefreshPriority } from './policy.js'

interface BatchProcessingOptions extends BatchExecutionOptions {
  readonly executeBatch?: typeof executeInstalledResourceBatchOperation
  readonly applyObservation?: typeof applyInstalledResourceObservation
  readonly getCapacity?: typeof getQueueAdmissionCapacity
  readonly recordFailure?: typeof recordInstalledResourceCollectionFailure
}

type LoadedBatchExecution = Extract<
  Awaited<ReturnType<typeof executeInstalledResourceBatchOperation>>,
  { readonly outcome: 'loaded' }
>

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

  const changed = await applyBatchClassifications(execution, options)
  if (changed.length === 0) return

  let admission: Awaited<ReturnType<typeof getQueueAdmissionCapacity>>
  try {
    admission = await (options.getCapacity ?? getQueueAdmissionCapacity)(queue, 'on-demand')
  } catch (error) {
    if (error instanceof QueueAdmissionError) return
    throw error
  }
  for (const subject of changed.slice(0, admission.remainingCapacity)) {
    // oxlint-disable-next-line no-await-in-loop
    await queue.add(resourceRefreshJobContract.name, subject.identity, {
      ...jobOptions(resourceRefreshJobContract),
      deduplication: { id: resourceRefreshJobContract.operationIdentity(subject.identity) },
      priority: resourceRefreshPriority(execution.resource.materializationIntervalSeconds),
    })
  }
}

async function applyBatchClassifications(
  execution: LoadedBatchExecution,
  options: BatchProcessingOptions,
) {
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
  return changed
}
