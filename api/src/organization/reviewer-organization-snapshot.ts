import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { DatabaseTransaction } from '../db/client.js'
import {
  deploymentSettings,
  platformCollectionState,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { projectManagedCorporationEvidence } from './managed-corporation-evidence.js'

const organizationLifecycles = alias(platformSubjectLifecycles, 'reviewer_organization_lifecycles')

export async function hasCurrentReviewerOrganizationSnapshot(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  now: Date,
) {
  const [organization] = await transaction
    .select({
      organizationType: deploymentSettings.organizationType,
      managedCorporationsValidatedAt: platformCollectionState.validatedAt,
      managedCorporationsNextEligibleAt: platformCollectionState.nextEligibleAt,
      managedCorporationsLastFailureClass: platformCollectionState.lastFailureClass,
      managedCorporationsFailureStartedAt: platformCollectionState.failureStartedAt,
    })
    .from(deploymentSettings)
    .leftJoin(
      organizationLifecycles,
      and(
        eq(organizationLifecycles.subjectKind, 'alliance'),
        eq(organizationLifecycles.organizationDeploymentId, deploymentSettings.id),
        eq(organizationLifecycles.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .leftJoin(
      platformCollectionState,
      and(
        eq(platformCollectionState.moduleId, 'core'),
        eq(platformCollectionState.resourceId, 'managed-corporations'),
        eq(platformCollectionState.subjectKind, 'alliance'),
        eq(platformCollectionState.subjectLifecycleId, organizationLifecycles.subjectLifecycleId),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
    .for('key share', { of: deploymentSettings })
  if (!organization) return false
  if (organization.organizationType === 'corporation') return true
  return (
    projectManagedCorporationEvidence(
      {
        validatedAt: organization.managedCorporationsValidatedAt,
        nextEligibleAt: organization.managedCorporationsNextEligibleAt,
        lastFailureClass: organization.managedCorporationsLastFailureClass,
        failureStartedAt: organization.managedCorporationsFailureStartedAt,
      },
      now,
    ).freshness === 'fresh'
  )
}
