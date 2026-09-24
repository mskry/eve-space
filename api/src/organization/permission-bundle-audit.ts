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
    actorId: input.actorUserId,
    actorType: 'user',
    deploymentId: 1,
    eventType: input.eventType,
    occurredAt: input.now,
    organizationVersion: organization.organizationVersion,
    outcome: input.eventType === 'permission-bundle.created' ? 'granted' : 'transitioned',
    policyVersion: organization.policyVersion,
    reason: input.reason,
    subjectId: input.bundleId,
    subjectType: 'permission_bundle',
  })
}
