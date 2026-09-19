import type { DatabaseTransaction } from '../db/client.js'
import { appendOrganizationAuditEvent } from './audit.js'

export async function appendPermissionBundleAudit(
  transaction: DatabaseTransaction,
  organization: { organizationVersion: number; policyVersion: number },
  input: {
    eventType: 'permission-bundle.created' | 'permission-bundle.updated'
    actorUserId: string
    bundleId: string
    reason: string
    now: Date
  },
) {
  return appendOrganizationAuditEvent(transaction, {
    deploymentId: 1,
    organizationVersion: organization.organizationVersion,
    policyVersion: organization.policyVersion,
    eventType: input.eventType,
    actorType: 'user',
    actorId: input.actorUserId,
    subjectType: 'permission_bundle',
    subjectId: input.bundleId,
    reason: input.reason,
    outcome: input.eventType === 'permission-bundle.created' ? 'granted' : 'transitioned',
    occurredAt: input.now,
  })
}
