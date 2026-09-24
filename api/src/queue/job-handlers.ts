import { sql } from '../db/client.js'
import { DomainEventValidationError } from '../domain-events/definitions.js'
import { DomainEventNotFoundError, dispatchDomainEvent } from '../domain-events/handlers.js'
import { deletePublishedDomainEvents } from '../domain-events/store.js'
import { env } from '../env.js'
import { refreshDerivedDirectorAuthority } from '../organization/derived-authority.js'
import { refreshOrganizationCorporationSource } from '../organization/corporation-sources.js'
import { refreshOrganizationOwnerEvidence } from '../organization/owner-evidence.js'
import { convergeObservedAffiliationInTransaction } from '../organization/authority-convergence.js'
import { processInstalledResourceRefresh } from '../platform/resource-refresh.js'
import { processAffiliationBatch } from '../characters/affiliation-sync.js'
import {
  hasJobContract,
  listJobContracts,
  type JobName,
  type JobPayloadByName,
} from './job-contracts.js'
import { outboxRelayStore, runOutboxRelayBatch } from './outbox-relay.js'
import type { QueuePlanningContext } from './planning-context.js'
import { runQueuePlanner } from './planner.js'
import { processInstalledResourceBatch } from './resource-batch-processor.js'

export interface JobExecutionContext extends QueuePlanningContext {
  readonly signal: AbortSignal
}

export type DeliveryDisposition =
  | { readonly type: 'completed' }
  | { readonly type: 'retryable'; readonly error: unknown }
  | { readonly type: 'permanent' }
  | { readonly type: 'delayed'; readonly retryAt: number }

type FailureDisposition = Exclude<DeliveryDisposition, { readonly type: 'completed' }>

interface JobHandler<Name extends JobName> {
  readonly name: Name
  process(payload: JobPayloadByName[Name], context: JobExecutionContext): Promise<void>
  classifyError(error: unknown): FailureDisposition
}

type JobHandlerRegistry = { readonly [Name in JobName]: JobHandler<Name> }

const jobHandlers = {
  affiliation: handler({
    name: 'affiliation',
    classifyError: delayedOr(retryable),
    async process({ characterIds }, context) {
      await processAffiliationBatch(
        characterIds,
        context.signal,
        convergeObservedAffiliationInTransaction,
      )
    },
  }),
  'corporation-source-evidence': handler({
    name: 'corporation-source-evidence',
    classifyError: retryable,
    async process(payload, context) {
      await refreshOrganizationCorporationSource(payload, { signal: context.signal })
    },
  }),
  'derived-authority': handler({
    name: 'derived-authority',
    classifyError: retryable,
    async process(payload, context) {
      await refreshDerivedDirectorAuthority(payload, { signal: context.signal })
    },
  }),
  diagnostic: handler({
    name: 'diagnostic',
    classifyError: retryable,
    async process() {
      await sql`select 1`
    },
  }),
  'domain-event': handler({
    name: 'domain-event',
    classifyError: (error) =>
      error instanceof DomainEventValidationError || error instanceof DomainEventNotFoundError
        ? { type: 'permanent' }
        : retryable(error),
    async process({ eventId }, context) {
      await dispatchDomainEvent(eventId, undefined, undefined, context.signal)
    },
  }),
  'domain-event-retention': handler({
    name: 'domain-event-retention',
    classifyError: retryable,
    async process(_payload, context) {
      context.signal.throwIfAborted()
      await deletePublishedDomainEvents({
        retentionMs: env.DOMAIN_EVENT_PUBLISHED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      })
    },
  }),
  'organization-owner-evidence': handler({
    name: 'organization-owner-evidence',
    classifyError: retryable,
    async process(payload, context) {
      await refreshOrganizationOwnerEvidence(payload, { signal: context.signal })
    },
  }),
  'outbox-relay': handler({
    name: 'outbox-relay',
    classifyError: retryable,
    async process(_payload, context) {
      await runOutboxRelayBatch(context.producer, context.outcomes, outboxRelayStore, {
        signal: context.signal,
      })
    },
  }),
  planner: handler({
    name: 'planner',
    classifyError: retryable,
    async process(_payload, context) {
      await runQueuePlanner(context)
    },
  }),
  'resource-batch': handler({
    name: 'resource-batch',
    classifyError: delayedOr(() => ({ type: 'permanent' })),
    async process(payload, context) {
      await processInstalledResourceBatch(payload, context.producer, context.signal)
    },
  }),
  'resource-refresh': handler({
    name: 'resource-refresh',
    classifyError: delayedOr(() => ({ type: 'permanent' })),
    async process(payload, context) {
      await processInstalledResourceRefresh(payload, { signal: context.signal })
    },
  }),
} satisfies JobHandlerRegistry

export async function executeJobHandler<Name extends JobName>(
  name: Name,
  payload: JobPayloadByName[Name],
  context: JobExecutionContext,
): Promise<DeliveryDisposition> {
  const job = jobHandlers[name] as JobHandler<Name>
  try {
    await job.process(payload, context)
    return { type: 'completed' }
  } catch (error) {
    context.signal.throwIfAborted()
    return job.classifyError(error)
  }
}

export function listJobHandlerNames() {
  return Object.keys(jobHandlers) as JobName[]
}

export function verifyJobHandlers(handlerNames: readonly string[] = listJobHandlerNames()) {
  const contractNames = new Set(listJobContracts().map(({ name }) => name))
  const registered = new Set<string>()
  for (const name of handlerNames) {
    if (registered.has(name)) {
      throw new Error(`Duplicate job handler ${name}`)
    }
    if (!hasJobContract(name)) {
      throw new Error(`Job handler ${name} has no contract`)
    }
    registered.add(name)
  }
  for (const name of contractNames) {
    if (!registered.has(name)) throw new Error(`Job contract ${name} has no handler`)
  }
}

function delayedRetryAt(error: unknown) {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('retryAt' in error) ||
    !(error.retryAt instanceof Date)
  ) {
    return null
  }
  const retryAt = error.retryAt.getTime()
  return Number.isFinite(retryAt) ? retryAt : null
}

function retryable(error: unknown): FailureDisposition {
  return { error, type: 'retryable' }
}

function delayedOr(
  fallback: (error: unknown) => FailureDisposition,
): (error: unknown) => FailureDisposition {
  return (error) => {
    const retryAt = delayedRetryAt(error)
    return retryAt === null ? fallback(error) : { retryAt, type: 'delayed' }
  }
}

function handler<Name extends JobName>(value: JobHandler<Name>) {
  return value
}
