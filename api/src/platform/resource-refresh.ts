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
import { materializeCoreResourceObservation } from './core-resource-materialization.js'
import {
  recomputeAllOrganizationAccountsInTransaction,
  recomputeComplianceForManagedCorporationsInTransaction,
} from '../organization/compliance.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import {
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
  readonly executeOperation?: typeof executeInstalledResourceOperation
  readonly applyObservation?: typeof applyInstalledResourceObservation
  readonly recordFailure?: typeof recordInstalledResourceCollectionFailure
}

export async function processInstalledResourceRefresh(
  identity: PlatformCollectionStateIdentity,
  options: ResourceRefreshProcessingOptions = {},
) {
  let execution: Awaited<ReturnType<typeof executeInstalledResourceOperation>>
  try {
    execution = await (options.executeOperation ?? executeInstalledResourceOperation)(identity)
  } catch (error) {
    await (options.recordFailure ?? recordInstalledResourceCollectionFailure)(identity, error)
    throw error
  }
  if (execution.outcome === 'noop') return

  try {
    await (options.applyObservation ?? applyInstalledResourceObservation)({
      identity,
      resource: execution.resource,
      subject: execution.subject,
      authorizationGeneration: execution.authorizationGeneration,
      validatedAt: execution.result.validatedAt,
      outcome: 'complete',
      data: execution.result.data,
    })
  } catch (error) {
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
} & ({ readonly outcome: 'complete'; readonly data: unknown } | { readonly outcome: 'unchanged' })

export async function applyInstalledResourceObservation(observation: PlatformResourceObservation) {
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
    await transaction`
      select module_id
      from deployment_modules
      where module_id = ${observation.identity.moduleId}
      for share
    `
    if (observation.subject.kind === 'character')
      await transaction`
        select pg_advisory_xact_lock_shared(
          ${characterLockNamespace},
          ${characterLockKey(observation.subject.characterId)}
        )
      `
    const eligibility = await resolveInstalledResourceEligibility(observation.identity, {
      connection: transaction,
      resources: [observation.resource],
    })
    if (
      eligibility.status !== 'eligible' ||
      !eligibility.due ||
      eligibility.authorizationGeneration !== observation.authorizationGeneration
    )
      return

    if (observation.outcome === 'complete') {
      const persistence = createTransactionScopedModulePersistenceCapability(
        transaction,
        observation.resource.moduleId,
      )
      await implementation.materialize({
        subject: observation.subject,
        data: observation.data,
        validatedAt: observation.validatedAt,
        authorizationGeneration: observation.authorizationGeneration,
        capabilities: { persistence: persistence.capability, sde: sdeCoreReads },
      })
      const suppressed = persistence.suppressedFailure()
      if (suppressed) throw suppressed.error
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
    const applied = await materializeCoreResourceObservation(transaction, {
      resourceId: observation.resource.resourceId,
      subject: observation.subject,
      data: observation.data,
      validatedAt,
      authorizationGeneration: observation.authorizationGeneration,
    })
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
  })
}
