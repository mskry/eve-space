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
  if (organization.organizationType === 'alliance') {
    await transaction.insert(platformSubjectLifecycles).values({
      subjectKind: 'alliance',
      subjectId: String(organization.organizationId),
      organizationDeploymentId: organization.deploymentId,
      organizationVersion: organization.organizationVersion,
      createdAt: now,
    })
    return
  }

  await transaction.insert(organizationManagedCorporations).values({
    deploymentId: organization.deploymentId,
    organizationVersion: organization.organizationVersion,
    corporationId: organization.organizationId,
    firstObservedAt: now,
    lastObservedAt: now,
  })
  await appendManagedCorporationEvent(transaction, 'added', {
    organizationVersion: organization.organizationVersion,
    corporationId: organization.organizationId,
    occurredAt: now,
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
  if (!current) return { outcome: 'obsolete' as const }
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
          deploymentId: 1,
          organizationVersion: input.organizationVersion,
          corporationId,
          firstObservedAt: input.validatedAt,
          lastObservedAt: input.validatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          organizationManagedCorporations.deploymentId,
          organizationManagedCorporations.organizationVersion,
          organizationManagedCorporations.corporationId,
        ],
        set: {
          isCurrent: true,
          lastObservedAt: input.validatedAt,
          removedAt: null,
          updatedAt: input.validatedAt,
        },
      })
  }
  if (removedIds.length > 0)
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
  await Promise.all(
    addedIds.map((corporationId) =>
      appendManagedCorporationEvent(transaction, 'added', {
        organizationVersion: input.organizationVersion,
        corporationId,
        occurredAt: input.validatedAt,
      }),
    ),
  )
  await Promise.all(
    removedIds.map((corporationId) =>
      appendManagedCorporationEvent(transaction, 'removed', {
        organizationVersion: input.organizationVersion,
        corporationId,
        occurredAt: input.validatedAt,
      }),
    ),
  )
  return {
    outcome: 'refreshed' as const,
    addedIds,
    removedIds,
    corporationIds: input.corporationIds,
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
    type: `organization.managed-corporation-${transition}`,
    payloadVersion: 1,
    aggregateId: '1',
    payload: {
      deploymentId: 1,
      organizationVersion: input.organizationVersion,
      corporationId: input.corporationId,
    },
    occurredAt: input.occurredAt,
  })
}
