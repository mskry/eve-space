import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'
import { sql as drizzleSql } from 'drizzle-orm'
import { db, sql } from '../db/client.js'
import {
  characterLockKey,
  characterLockNamespace,
  resourceRefreshLockKey,
  resourceRefreshLockNamespace,
} from '../db/locks.js'
import { createTransactionScopedModulePersistenceCapability } from '../db/module-persistence.js'
import { sdeCoreReads } from './core-read-capabilities.js'
import { createPlatformModuleLogger } from './module-logging.js'
import { materializeCoreResourceObservation } from './core-resource-materialization.js'
import {
  recomputeAllOrganizationAccountsInTransaction,
  recomputeComplianceForManagedCorporationsInTransaction,
} from '../organization/compliance.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import {
  loadPlatformCollectionState,
  upsertPlatformCollectionState,
  upsertPlatformCollectionStateInTransaction,
} from './collection-state-store.js'
import { recordInstalledResourceCollectionSuccess } from './collection-status.js'
import { resolveInstalledResourceEligibility } from './resource-eligibility.js'
import { executeInstalledResourceOperation } from './resource-operation-executor.js'
import {
  PlatformResourcePersistenceError,
  recordInstalledResourceCollectionFailure,
} from './resource-failures.js'

interface ResourceRefreshProcessingOptions {
  readonly signal?: AbortSignal
  readonly executeOperation?: typeof executeInstalledResourceOperation
  readonly applyObservation?: typeof applyInstalledResourceObservation
  readonly recordFailure?: typeof recordInstalledResourceCollectionFailure
}

export async function processInstalledResourceRefresh(
  identity: PlatformCollectionStateIdentity,
  options: ResourceRefreshProcessingOptions = {},
) {
  options.signal?.throwIfAborted()
  let execution: Awaited<ReturnType<typeof executeInstalledResourceOperation>>
  try {
    execution = await (options.executeOperation ?? executeInstalledResourceOperation)(identity, {
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    await (options.recordFailure ?? recordInstalledResourceCollectionFailure)(identity, error)
    throw error
  }
  if (execution.outcome === 'noop') return
  options.signal?.throwIfAborted()

  try {
    await (options.applyObservation ?? applyInstalledResourceObservation)({
      identity,
      resource: execution.resource,
      subject: execution.subject,
      authorizationGeneration: execution.authorizationGeneration,
      validatedAt: execution.result.validatedAt,
      organizationVersion: execution.organizationVersion,
      complete: execution.complete,
      outcome: 'complete',
      data: execution.result.data,
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    const failure = new PlatformResourcePersistenceError(error)
    await (options.recordFailure ?? recordInstalledResourceCollectionFailure)(identity, failure)
    throw failure
  }
}

type PlatformResourceObservation = {
  readonly identity: PlatformCollectionStateIdentity
  readonly resource: PlatformInstalledResourceDescriptor
  readonly subject: PlatformResourceSubject
  readonly authorizationGeneration: number | null
  readonly validatedAt: string
  readonly organizationVersion?: number
  readonly complete?: boolean
  readonly signal?: AbortSignal
} & ({ readonly outcome: 'complete'; readonly data: unknown } | { readonly outcome: 'unchanged' })

export async function applyInstalledResourceObservation(observation: PlatformResourceObservation) {
  observation.signal?.throwIfAborted()
  if (observation.resource.moduleId === 'core') {
    await applyCoreResourceObservation(observation)
    return
  }
  const implementation = observation.resource
    .implementation as PlatformResourceOperationImplementation<
    string,
    unknown,
    unknown,
    string,
    unknown,
    PlatformResourceSubject
  >
  await sql.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        ${resourceRefreshLockNamespace},
        ${resourceRefreshLockKey(observation.identity)}
      )
    `
    observation.signal?.throwIfAborted()
    await transaction`
      select module_id
      from deployment_modules
      where module_id = ${observation.identity.moduleId}
      for share
    `
    observation.signal?.throwIfAborted()
    if (observation.subject.kind === 'character')
      await transaction`
        select pg_advisory_xact_lock_shared(
          ${characterLockNamespace},
          ${characterLockKey(observation.subject.characterId)}
        )
      `
    observation.signal?.throwIfAborted()
    const eligibility = await resolveInstalledResourceEligibility(observation.identity, {
      connection: transaction,
      resources: [observation.resource],
      signal: observation.signal,
    })
    if (
      eligibility.status !== 'eligible' ||
      !eligibility.due ||
      eligibility.authorizationGeneration !== observation.authorizationGeneration
    )
      return

    if (observation.organizationVersion !== undefined) {
      await transaction`select id from deployment_settings where id = 1 for share`
      const [settings] = await transaction<{ version: number }[]>`
        select organization_version::integer as version from deployment_settings where id = 1
      `
      observation.signal?.throwIfAborted()
      if (settings?.version !== observation.organizationVersion) return
    }
    if (observation.outcome === 'complete') {
      const persistence = createTransactionScopedModulePersistenceCapability(
        transaction,
        observation.resource.moduleId,
      )
      const materialized = await implementation.materialize({
        subject: observation.subject,
        data: observation.data,
        validatedAt: observation.validatedAt,
        authorizationGeneration: observation.authorizationGeneration,
        capabilities: {
          logger: createPlatformModuleLogger(observation.resource.moduleId),
          persistence: persistence.capability,
          sde: sdeCoreReads,
        },
      })
      observation.signal?.throwIfAborted()
      const suppressed = persistence.suppressedFailure()
      if (suppressed) throw suppressed.error
      if (materialized?.outcome === 'obsolete') return
    }

    if (observation.complete === false) {
      const previous = await transaction<{ validatedAt: Date | null }[]>`
        select validated_at as "validatedAt" from platform_collection_state
        where module_id = ${observation.identity.moduleId}
          and resource_id = ${observation.identity.resourceId}
          and subject_kind = ${observation.identity.subjectKind}
          and subject_lifecycle_id = ${observation.identity.subjectLifecycleId}
          and subject_id = ${observation.identity.subjectId}
      `
      observation.signal?.throwIfAborted()
      await upsertPlatformCollectionStateInTransaction(
        {
          ...observation.identity,
          nextEligibleAt: new Date(0),
          authorizationGeneration: observation.authorizationGeneration,
          validatedAt: previous[0]?.validatedAt ?? null,
          lastFailureClass: null,
        },
        transaction,
      )
      observation.signal?.throwIfAborted()
      return
    }
    await recordInstalledResourceCollectionSuccess(
      observation.identity,
      { validatedAt: observation.validatedAt },
      observation.authorizationGeneration,
      {
        resources: [observation.resource],
        upsertState: (input) => upsertPlatformCollectionStateInTransaction(input, transaction),
      },
    )
    observation.signal?.throwIfAborted()
  })
}

async function applyCoreResourceObservation(observation: PlatformResourceObservation) {
  if (observation.outcome !== 'complete') return
  const validatedAt = new Date(observation.validatedAt)
  if (Number.isNaN(validatedAt.getTime()))
    throw new Error('ESI representation validation time is invalid')

  await db.transaction(async (transaction) => {
    await transaction.execute(
      drizzleSql`select pg_advisory_xact_lock(
        ${resourceRefreshLockNamespace},
        ${resourceRefreshLockKey(observation.identity)}
      )`,
    )
    observation.signal?.throwIfAborted()
    const currentState = await loadPlatformCollectionState(observation.identity, transaction)
    observation.signal?.throwIfAborted()
    if (currentState?.validatedAt && currentState.validatedAt >= validatedAt) return

    const applied = await materializeCoreResourceObservation(transaction, {
      resourceId: observation.resource.resourceId,
      subject: observation.subject,
      data: observation.data,
      validatedAt,
      authorizationGeneration: observation.authorizationGeneration,
    })
    observation.signal?.throwIfAborted()
    if (!applied) return

    await recordInstalledResourceCollectionSuccess(
      observation.identity,
      { validatedAt: observation.validatedAt },
      observation.authorizationGeneration,
      {
        resources: [observation.resource],
        upsertState: (input) => upsertPlatformCollectionState(input, transaction),
      },
    )
    observation.signal?.throwIfAborted()
    if (applied.recomputeAllAccounts)
      await recomputeAllOrganizationAccountsInTransaction(transaction, {
        deploymentId: 1,
        organizationVersion: applied.organizationVersion,
        now: new Date(),
      })
    else if (applied.affectedCorporationIds.length > 0)
      await recomputeComplianceForManagedCorporationsInTransaction(transaction, {
        deploymentId: 1,
        organizationVersion: applied.organizationVersion,
        corporationIds: applied.affectedCorporationIds,
        now: new Date(),
      })
    observation.signal?.throwIfAborted()
  })
}
