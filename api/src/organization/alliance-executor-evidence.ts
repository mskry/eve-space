import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { getAlliancePublicResult } from '../alliances/public-data.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import { deploymentSettings, organizationAllianceExecutorObservations } from '../db/schema.js'
import { lockCurrentOrganization } from './organization-lock.js'

type Database = DatabaseTransaction | typeof db

interface ExecutorDemandRow extends Record<string, unknown> {
  readonly organizationVersion: string
  readonly expectedRevision: string | null
  readonly nextRefreshAt: Date | string | null
}

export interface CurrentAllianceExecutor {
  readonly corporationId: number
  readonly revision: string
  readonly freshUntil: Date
}

const loadObservation = async (database: Database, organizationVersion: number) => {
  const [observation] = await database
    .select()
    .from(organizationAllianceExecutorObservations)
    .where(
      and(
        eq(organizationAllianceExecutorObservations.deploymentId, 1),
        eq(organizationAllianceExecutorObservations.organizationVersion, organizationVersion),
      ),
    )
  return observation ?? null
}

export const loadCurrentAllianceExecutor = async (
  database: Database,
  organizationVersion: number,
  now = new Date(),
): Promise<CurrentAllianceExecutor | null> => {
  const [organization] = await database
    .select({
      organizationId: deploymentSettings.organizationId,
      organizationType: deploymentSettings.organizationType,
    })
    .from(deploymentSettings)
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
  if (organization?.organizationType !== 'alliance') {
    return null
  }
  const observation = await loadObservation(database, organizationVersion)
  if (
    observation?.allianceId !== organization.organizationId ||
    observation?.status !== 'fresh' ||
    !observation.executorCorporationId ||
    !observation.executorRevision ||
    !observation.freshUntil ||
    observation.freshUntil <= now
  ) {
    return null
  }
  return {
    corporationId: observation.executorCorporationId,
    revision: observation.executorRevision,
    freshUntil: observation.freshUntil,
  }
}

export const selectDueAllianceExecutor = async (
  database: Database = db,
  dueBefore = new Date(),
) => {
  const [row] = await database.execute<ExecutorDemandRow>(sql`
    select settings.organization_version::text as "organizationVersion",
      observation.executor_revision as "expectedRevision",
      observation.next_refresh_at as "nextRefreshAt"
    from deployment_settings settings
    left join organization_alliance_executor_observations observation
      on observation.deployment_id = settings.id
      and observation.organization_version = settings.organization_version
    where settings.id = 1 and settings.organization_type = 'alliance'
      and exists (
        select 1 from organization_group_rules rule
        where rule.deployment_id = settings.id
          and rule.organization_version = settings.organization_version
          and rule.enabled
          and (rule.condition_kind = 'corporation-role'
            or (rule.condition_kind = 'director-audience'
              and settings.derived_director_authority_enabled))
      )
      and (observation.next_refresh_at is null
        or observation.next_refresh_at <= ${dueBefore.toISOString()}::timestamptz)
  `)
  return row
    ? {
        organizationVersion: Number(row.organizationVersion),
        expectedRevision: row.expectedRevision,
        nextRefreshAt: row.nextRefreshAt ? new Date(row.nextRefreshAt) : null,
      }
    : null
}

export const allianceExecutorRefreshDemanded = async (
  organizationVersion: number,
  expectedRevision: string | null,
  now = new Date(),
) => {
  const due = await selectDueAllianceExecutor(db, now)
  return (
    due?.organizationVersion === organizationVersion && due.expectedRevision === expectedRevision
  )
}

const allocateObservationSequence = async () => {
  const [row] = await db.execute<{ sequence: string }>(
    sql`select nextval('organization_alliance_executor_observation_sequence')::text as sequence`,
  )
  if (!row) {
    throw new Error('Failed to allocate alliance executor observation sequence')
  }
  return BigInt(row.sequence)
}

export const observeAllianceExecutor = async (
  expectedOrganizationVersion: number,
  onChange?: (
    transaction: DatabaseTransaction,
    observation: typeof organizationAllianceExecutorObservations.$inferSelect,
  ) => Promise<void>,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted()
  const [organization] = await db
    .select({
      organizationId: deploymentSettings.organizationId,
      organizationType: deploymentSettings.organizationType,
    })
    .from(deploymentSettings)
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, expectedOrganizationVersion),
      ),
    )
  if (organization?.organizationType !== 'alliance') {
    return { outcome: 'superseded' as const }
  }

  const sequence = await allocateObservationSequence()
  let result: Awaited<ReturnType<typeof getAlliancePublicResult>>
  try {
    signal?.throwIfAborted()
    const { getAlliancePublicResult } = await import('../alliances/public-data.js')
    signal?.throwIfAborted()
    result = await getAlliancePublicResult(organization.organizationId, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && error.name === 'AbortError') throw error
    return retryExecutorObservation(
      expectedOrganizationVersion,
      organization.organizationId,
      sequence,
      signal,
    )
  }

  signal?.throwIfAborted()
  const validatedAt = new Date(result.validatedAt)
  const freshUntil = new Date(result.cachedUntil)
  if (
    result.stale ||
    !Number.isFinite(validatedAt.getTime()) ||
    !Number.isFinite(freshUntil.getTime()) ||
    freshUntil <= validatedAt
  ) {
    return retryExecutorObservation(
      expectedOrganizationVersion,
      organization.organizationId,
      sequence,
      signal,
    )
  }

  return db.transaction(async (transaction) => {
    signal?.throwIfAborted()
    const current = await lockCurrentOrganization(transaction)
    if (
      current.organizationVersion !== expectedOrganizationVersion ||
      current.organizationType !== 'alliance'
    ) {
      return { outcome: 'superseded' as const }
    }
    const previous = await lockExecutorObservation(
      transaction,
      expectedOrganizationVersion,
      organization.organizationId,
    )
    if (sequence <= previous.lastAppliedSequence) {
      return { outcome: 'superseded' as const }
    }
    signal?.throwIfAborted()
    const executorCorporationId = result.data.executorCorporationId
    const changed =
      previous.executorCorporationId !== executorCorporationId || previous.executorRevision === null
    const freshnessChanged = previous.freshUntil?.getTime() !== freshUntil.getTime()
    const [updated] = await transaction
      .update(organizationAllianceExecutorObservations)
      .set({
        executorCorporationId,
        executorRevision: changed ? randomUUID() : previous.executorRevision,
        freshUntil,
        lastAppliedSequence: sequence,
        nextRefreshAt: freshUntil,
        status: executorCorporationId ? 'fresh' : 'invalid',
        updatedAt: new Date(),
        validatedAt,
      })
      .where(
        eq(
          organizationAllianceExecutorObservations.organizationVersion,
          expectedOrganizationVersion,
        ),
      )
      .returning()
    if ((changed || freshnessChanged || previous.status !== 'fresh') && updated && onChange) {
      await onChange(transaction, updated)
    }
    signal?.throwIfAborted()
    return { outcome: 'accepted' as const, changed, observation: updated! }
  })
}

const lockExecutorObservation = async (
  transaction: DatabaseTransaction,
  organizationVersion: number,
  allianceId: number,
) => {
  await transaction
    .insert(organizationAllianceExecutorObservations)
    .values({
      allianceId,
      nextRefreshAt: new Date(),
      organizationVersion,
    })
    .onConflictDoNothing()
  const [observation] = await transaction
    .select()
    .from(organizationAllianceExecutorObservations)
    .where(eq(organizationAllianceExecutorObservations.organizationVersion, organizationVersion))
    .for('update')
  if (!observation) {
    throw new Error('Alliance executor observation was not locked')
  }
  return observation
}

const retryExecutorObservation = async (
  organizationVersion: number,
  allianceId: number,
  sequence: bigint,
  signal?: AbortSignal,
) =>
  db.transaction(async (transaction) => {
    signal?.throwIfAborted()
    const current = await lockCurrentOrganization(transaction)
    if (
      current.organizationVersion !== organizationVersion ||
      current.organizationType !== 'alliance'
    ) {
      return { outcome: 'superseded' as const }
    }
    const previous = await lockExecutorObservation(transaction, organizationVersion, allianceId)
    if (sequence <= previous.lastAppliedSequence) {
      return { outcome: 'superseded' as const }
    }
    signal?.throwIfAborted()
    await transaction
      .update(organizationAllianceExecutorObservations)
      .set({
        lastAppliedSequence: sequence,
        nextRefreshAt: new Date(Date.now() + 5 * 60_000),
        updatedAt: new Date(),
      })
      .where(eq(organizationAllianceExecutorObservations.organizationVersion, organizationVersion))
    signal?.throwIfAborted()
    return { outcome: 'unavailable' as const }
  })
