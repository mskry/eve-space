import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import { sql as drizzleSql } from 'drizzle-orm'
import type postgres from 'postgres'
import { db, sql, type DatabaseTransaction } from '../db/client.js'
import {
  characterLockKey,
  characterLockNamespace,
  resourceRefreshLockKey,
  resourceRefreshLockNamespace,
} from '../db/locks.js'
import { createPlatformModuleLogger } from './module-logging.js'
import { createPlatformResourceMaterializationPersistence } from './module-persistence-capabilities.js'
import { materializeCoreResourceObservation } from './core-resource-materialization.js'
import {
  recomputeAllOrganizationAccountsInTransaction,
  recomputeComplianceForManagedCorporationsInTransaction,
} from '../organization/compliance.js'
import {
  isCorporationSourceExecutionCurrent,
  lockCorporationSourceExecutionCurrent,
} from '../organization/roster-collection.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import {
  loadPlatformCollectionState,
  upsertPlatformCollectionState,
  upsertPlatformCollectionStateInTransaction,
} from './collection-state-store.js'
import { recordInstalledResourceCollectionSuccess } from './collection-status.js'
import {
  corporationAuthorityFenceEquals,
  createCorporationContinuationAuthorityBinding,
  managedCollectionAuthorityEquals,
  resolveInstalledResourceEligibility,
  type PlatformCorporationAuthorityFence,
  type PlatformManagedCollectionAuthority,
  type PlatformResourceEligibility,
} from './resource-eligibility.js'
import { executeInstalledResourceOperation } from './resource-operation-executor.js'
import { guardInstalledResourceExecution } from './resource-execution-guard.js'
import {
  PlatformResourcePersistenceError,
  PlatformResourceObsoleteError,
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
  let attemptAuthority:
    | {
        readonly authorizationGeneration: number | null
        readonly managedAuthority: PlatformManagedCollectionAuthority | null
        readonly corporationAuthorityFence?: PlatformCorporationAuthorityFence
      }
    | undefined
  try {
    execution = await (options.executeOperation ?? executeInstalledResourceOperation)(identity, {
      guardExecution: guardCoreInstalledResourceExecution,
      onAuthorityResolved(authority) {
        attemptAuthority = authority
      },
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof PlatformResourceObsoleteError) return
    await (options.recordFailure ?? recordInstalledResourceCollectionFailure)(
      identity,
      error,
      attemptAuthority
        ? {
            expectedAuthorizationGeneration: attemptAuthority.authorizationGeneration,
            expectedManagedAuthority: attemptAuthority.managedAuthority,
            expectedCorporationAuthorityFence: attemptAuthority.corporationAuthorityFence,
          }
        : {},
    )
    throw error
  }
  if (execution.outcome === 'noop') {
    return
  }
  options.signal?.throwIfAborted()

  try {
    await (options.applyObservation ?? applyInstalledResourceObservation)({
      authorizationCharacterId: execution.authorizationCharacterId,
      authorizationCharacterLifecycleId: execution.authorizationCharacterLifecycleId,
      authorizationGeneration: execution.authorizationGeneration,
      complete: execution.complete,
      data: execution.result.data,
      identity,
      managedAuthority: execution.managedAuthority,
      organizationVersion: execution.organizationVersion,
      ...(execution.corporationAuthorityFence && {
        corporationAuthorityFence: execution.corporationAuthorityFence,
      }),
      outcome: 'complete',
      resource: execution.resource,
      signal: options.signal,
      subject: execution.subject,
      validatedAt: execution.result.validatedAt,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    const failure = new PlatformResourcePersistenceError(error)
    await (options.recordFailure ?? recordInstalledResourceCollectionFailure)(identity, failure, {
      expectedAuthorizationGeneration: execution.authorizationGeneration,
      expectedManagedAuthority: execution.managedAuthority,
      expectedCorporationAuthorityFence: execution.corporationAuthorityFence,
    })
    throw failure
  }
}

function guardCoreInstalledResourceExecution(
  identity: PlatformCollectionStateIdentity,
  options: Parameters<typeof guardInstalledResourceExecution>[1] = {},
) {
  return guardInstalledResourceExecution(identity, {
    ...options,
    isCorporationSourceCurrent: isCorporationSourceExecutionCurrent,
  })
}

type PlatformResourceObservation = {
  readonly identity: PlatformCollectionStateIdentity
  readonly resource: PlatformInstalledResourceDescriptor
  readonly subject: PlatformResourceSubject
  readonly authorizationGeneration: number | null
  readonly authorizationCharacterId?: number | null
  readonly authorizationCharacterLifecycleId?: string | null
  readonly managedAuthority: PlatformManagedCollectionAuthority | null
  readonly corporationAuthorityFence?: PlatformCorporationAuthorityFence
  readonly validatedAt: string
  readonly organizationVersion?: number
  readonly complete?: boolean
  readonly signal?: AbortSignal
} & ({ readonly outcome: 'complete'; readonly data: unknown } | { readonly outcome: 'unchanged' })

const isCurrentObservationEligibility = (
  eligibility: PlatformResourceEligibility,
  observation: PlatformResourceObservation,
): eligibility is Extract<PlatformResourceEligibility, { status: 'eligible' }> => {
  if (eligibility.status !== 'eligible') return false
  const admitted = [
    eligibility.due,
    eligibility.authorizationGeneration === observation.authorizationGeneration,
    managedCollectionAuthorityEquals(eligibility.managedAuthority, observation.managedAuthority),
  ].every(Boolean)
  if (!admitted) return false
  if (observation.subject.kind !== 'corporation') return true
  return (
    Boolean(observation.corporationAuthorityFence) &&
    corporationAuthorityFenceEquals(
      observation.corporationAuthorityFence,
      eligibility.corporationAuthorityFence,
    )
  )
}

export async function applyInstalledResourceObservation(
  observation: PlatformResourceObservation,
  options: { readonly connection?: postgres.Sql } = {},
) {
  observation.signal?.throwIfAborted()
  if (observation.resource.moduleId === 'core') {
    await applyCoreResourceObservation(observation)
    return
  }
  const implementation = observation.resource.implementation as PlatformResourceImplementation
  await (options.connection ?? sql).begin(async (transaction) => {
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
    if (observation.resource.sectionId) {
      await transaction`
        select module_id, section_id
        from deployment_module_sections
        where module_id = ${observation.identity.moduleId}
          and section_id = ${observation.resource.sectionId}
        for share
      `
    }
    observation.signal?.throwIfAborted()
    if (observation.subject.kind === 'character') {
      await transaction`
        select pg_advisory_xact_lock_shared(
          ${characterLockNamespace},
          ${characterLockKey(observation.subject.characterId)}
        )
      `
    }
    observation.signal?.throwIfAborted()
    const eligibility = await resolveInstalledResourceEligibility(observation.identity, {
      connection: transaction,
      lockAuthority: true,
      resources: [observation.resource],
      signal: observation.signal,
    })
    if (!isCurrentObservationEligibility(eligibility, observation)) return
    if (
      observation.subject.kind === 'corporation' &&
      !(await lockCurrentCorporationSource(transaction, observation, eligibility))
    ) {
      return
    }

    if (!(await observationOrganizationVersionMatches(transaction, observation))) {
      return
    }
    if (observation.outcome === 'complete') {
      const materialized = await materializeInstalledResourceObservation(
        transaction,
        observation,
        implementation,
      )
      observation.signal?.throwIfAborted()
      if (materialized?.outcome === 'obsolete') {
        return
      }
    }

    if (observation.complete === false) {
      await recordIncompleteObservation(transaction, observation, eligibility)
      return
    }
    await recordInstalledResourceCollectionSuccess(
      observation.identity,
      { validatedAt: observation.validatedAt },
      observation.authorizationGeneration,
      {
        managedAuthority: eligibility.managedAuthority,
        resources: [observation.resource],
        upsertState: (input) => upsertPlatformCollectionStateInTransaction(input, transaction),
      },
    )
    observation.signal?.throwIfAborted()
  })
}

async function observationOrganizationVersionMatches(
  transaction: postgres.TransactionSql,
  observation: PlatformResourceObservation,
) {
  if (observation.organizationVersion === undefined) {
    return true
  }
  await transaction`select id from deployment_settings where id = 1 for share`
  const [settings] = await transaction<{ version: number }[]>`
    select organization_version::integer as version from deployment_settings where id = 1
  `
  observation.signal?.throwIfAborted()
  return settings?.version === observation.organizationVersion
}

async function recordIncompleteObservation(
  transaction: postgres.TransactionSql,
  observation: PlatformResourceObservation,
  eligibility: Extract<
    Awaited<ReturnType<typeof resolveInstalledResourceEligibility>>,
    { status: 'eligible' }
  >,
) {
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
      ...eligibility.managedAuthority,
      validatedAt: previous[0]?.validatedAt ?? null,
      lastFailureClass: null,
    },
    transaction,
  )
  observation.signal?.throwIfAborted()
}

async function materializeInstalledResourceObservation(
  transaction: postgres.TransactionSql,
  observation: Extract<PlatformResourceObservation, { outcome: 'complete' }>,
  implementation: PlatformResourceImplementation,
) {
  const persistence = createPlatformResourceMaterializationPersistence(
    transaction,
    observation.resource.moduleId,
    observation.resource.resourceId,
    observation.signal,
  )
  try {
    const result = await implementation.materialize({
      ...materializationContext(observation),
      capabilities: {
        logger: createPlatformModuleLogger(observation.resource.moduleId),
        persistence: persistence.persistence as never,
      },
    })
    const suppressed = persistence.suppressedFailure()
    if (suppressed) {
      throw suppressed.error
    }
    return result
  } finally {
    persistence.close()
  }
}

async function lockCurrentCorporationSource(
  transaction: postgres.TransactionSql,
  observation: PlatformResourceObservation,
  eligibility: Extract<
    Awaited<ReturnType<typeof resolveInstalledResourceEligibility>>,
    { status: 'eligible' }
  >,
) {
  if (observation.subject.kind !== 'corporation') {
    return true
  }
  const characterId = observation.authorizationCharacterId
  const characterSubjectLifecycleId = observation.authorizationCharacterLifecycleId
  const authorizationGeneration = observation.authorizationGeneration
  if (!characterId || !characterSubjectLifecycleId || authorizationGeneration === null) {
    return false
  }
  if (
    eligibility.authorizationCharacterId !== characterId ||
    eligibility.authorizationCharacterLifecycleId !== characterSubjectLifecycleId ||
    eligibility.authorizationGeneration !== authorizationGeneration
  ) {
    return false
  }
  return lockCorporationSourceExecutionCurrent(transaction, {
    authorizationGeneration,
    characterId,
    characterSubjectLifecycleId,
    corporationSubjectLifecycleId: observation.subject.lifecycleId,
  })
}

function materializationContext(
  observation: Extract<PlatformResourceObservation, { outcome: 'complete' }>,
) {
  return {
    authorizationGeneration: observation.authorizationGeneration,
    data: observation.data,
    managedAuthority: observation.managedAuthority,
    ...(observation.corporationAuthorityFence && {
      continuationAuthorityBinding: createCorporationContinuationAuthorityBinding(
        observation.corporationAuthorityFence,
      ),
    }),
    organizationVersion:
      observation.organizationVersion ?? observation.managedAuthority?.organizationVersion ?? null,
    subject: observation.subject,
    validatedAt: observation.validatedAt,
  }
}

async function applyCoreResourceObservation(observation: PlatformResourceObservation) {
  if (observation.outcome !== 'complete') {
    return
  }
  const validatedAt = new Date(observation.validatedAt)
  if (Number.isNaN(validatedAt.getTime())) {
    throw new TypeError('ESI representation validation time is invalid')
  }

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
    if (currentState?.validatedAt && currentState.validatedAt >= validatedAt) {
      return
    }
    if (
      observation.subject.kind === 'corporation' &&
      !(await lockCoreCorporationSource(transaction, observation))
    ) {
      return
    }

    const applied = await materializeCoreResourceObservation(transaction, {
      authorizationGeneration: observation.authorizationGeneration,
      data: observation.data,
      resourceId: observation.resource.resourceId,
      subject: observation.subject,
      validatedAt,
    })
    observation.signal?.throwIfAborted()
    if (!applied) {
      return
    }

    const rotateManagedMemberLifecycles = Boolean(
      applied.recomputeAllAccounts &&
      currentState &&
      (currentState.lastFailureClass !== null ||
        !currentState.nextEligibleAt ||
        currentState.nextEligibleAt <= validatedAt),
    )

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
    if (applied.recomputeAllAccounts) {
      await recomputeAllOrganizationAccountsInTransaction(transaction, {
        deploymentId: 1,
        now: new Date(),
        organizationVersion: applied.organizationVersion,
        rotateManagedMemberLifecycles,
      })
    } else if (applied.affectedCorporationIds.length > 0) {
      await recomputeComplianceForManagedCorporationsInTransaction(transaction, {
        corporationIds: applied.affectedCorporationIds,
        deploymentId: 1,
        now: new Date(),
        organizationVersion: applied.organizationVersion,
      })
    }
    observation.signal?.throwIfAborted()
  })
}

async function lockCoreCorporationSource(
  transaction: DatabaseTransaction,
  observation: PlatformResourceObservation,
) {
  if (observation.subject.kind !== 'corporation') {
    return true
  }
  if (
    !observation.authorizationCharacterId ||
    !observation.authorizationCharacterLifecycleId ||
    observation.authorizationGeneration === null
  ) {
    return false
  }
  return isCorporationSourceExecutionCurrent(
    {
      authorizationGeneration: observation.authorizationGeneration,
      characterId: observation.authorizationCharacterId,
      characterSubjectLifecycleId: observation.authorizationCharacterLifecycleId,
      corporationSubjectLifecycleId: observation.subject.lifecycleId,
    },
    transaction,
  )
}
