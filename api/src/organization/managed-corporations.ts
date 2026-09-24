import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'

type Transaction = Pick<typeof db, 'insert' | 'select' | 'update'>

export async function initializeManagedOrganization(
  transaction: Transaction,
  organization: {
    deploymentId: number
    organizationVersion: number
    organizationType: 'corporation' | 'alliance'
    organizationId: number
  },
  now: Date,
) {
  await transaction.insert(platformSubjectLifecycles).values({
    createdAt: now,
    organizationDeploymentId: organization.deploymentId,
    organizationVersion: organization.organizationVersion,
    subjectId: String(organization.deploymentId),
    subjectKind: 'deployment',
  })
  if (organization.organizationType === 'alliance') {
    await transaction.insert(platformSubjectLifecycles).values({
      createdAt: now,
      organizationDeploymentId: organization.deploymentId,
      organizationVersion: organization.organizationVersion,
      subjectId: String(organization.organizationId),
      subjectKind: 'alliance',
    })
    return
  }

  await transaction.insert(organizationManagedCorporations).values({
    corporationId: organization.organizationId,
    deploymentId: organization.deploymentId,
    firstObservedAt: now,
    lastObservedAt: now,
    organizationVersion: organization.organizationVersion,
  })
  await appendManagedCorporationEvent(transaction, 'added', {
    corporationId: organization.organizationId,
    occurredAt: now,
    organizationVersion: organization.organizationVersion,
  })
}

export async function materializeManagedAllianceCorporations(
  transaction: Transaction,
  input: {
    organizationVersion: number
    allianceId: number
    corporationIds: number[]
    validatedAt: Date
  },
) {
  const current = await lockAllianceOrganization(
    transaction,
    input.organizationVersion,
    input.allianceId,
  )
  if (!current) {
    return { outcome: 'obsolete' as const }
  }
  const existing = await transaction
    .select()
    .from(organizationManagedCorporations)
    .where(
      and(
        eq(organizationManagedCorporations.deploymentId, 1),
        eq(organizationManagedCorporations.organizationVersion, input.organizationVersion),
      ),
    )
    .for('update')
  const currentIds = new Set(
    existing.filter(({ isCurrent }) => isCurrent).map(({ corporationId }) => corporationId),
  )
  const nextIds = new Set(input.corporationIds)
  const addedIds = input.corporationIds.filter((corporationId) => !currentIds.has(corporationId))
  const removedIds = [...currentIds].filter((corporationId) => !nextIds.has(corporationId))

  if (input.corporationIds.length > 0) {
    await transaction
      .insert(organizationManagedCorporations)
      .values(
        input.corporationIds.map((corporationId) => ({
          corporationId,
          deploymentId: 1,
          firstObservedAt: input.validatedAt,
          lastObservedAt: input.validatedAt,
          organizationVersion: input.organizationVersion,
        })),
      )
      .onConflictDoUpdate({
        set: {
          isCurrent: true,
          lastObservedAt: input.validatedAt,
          removedAt: null,
          updatedAt: input.validatedAt,
        },
        target: [
          organizationManagedCorporations.deploymentId,
          organizationManagedCorporations.organizationVersion,
          organizationManagedCorporations.corporationId,
        ],
      })
  }
  if (removedIds.length > 0) {
    await transaction
      .update(organizationManagedCorporations)
      .set({
        isCurrent: false,
        removedAt: input.validatedAt,
        updatedAt: input.validatedAt,
      })
      .where(
        and(
          eq(organizationManagedCorporations.deploymentId, 1),
          eq(organizationManagedCorporations.organizationVersion, input.organizationVersion),
          inArray(organizationManagedCorporations.corporationId, removedIds),
        ),
      )
  }
  await Promise.all(
    addedIds.map((corporationId) =>
      appendManagedCorporationEvent(transaction, 'added', {
        corporationId,
        occurredAt: input.validatedAt,
        organizationVersion: input.organizationVersion,
      }),
    ),
  )
  await Promise.all(
    removedIds.map((corporationId) =>
      appendManagedCorporationEvent(transaction, 'removed', {
        corporationId,
        occurredAt: input.validatedAt,
        organizationVersion: input.organizationVersion,
      }),
    ),
  )
  return {
    addedIds,
    corporationIds: input.corporationIds,
    outcome: 'refreshed' as const,
    removedIds,
  }
}

async function lockAllianceOrganization(
  transaction: Transaction,
  organizationVersion: number,
  allianceId: number,
) {
  const [organization] = await transaction
    .select({ id: deploymentSettings.id })
    .from(deploymentSettings)
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationType, 'alliance'),
        eq(deploymentSettings.organizationId, allianceId),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
    .for('update')
  return organization
}

function appendManagedCorporationEvent(
  transaction: Transaction,
  transition: 'added' | 'removed',
  input: { organizationVersion: number; corporationId: number; occurredAt: Date },
) {
  return appendDomainEvent(transaction, {
    aggregateId: '1',
    occurredAt: input.occurredAt,
    payload: {
      corporationId: input.corporationId,
      deploymentId: 1,
      organizationVersion: input.organizationVersion,
    },
    payloadVersion: 1,
    type: `organization.managed-corporation-${transition}`,
  })
}
