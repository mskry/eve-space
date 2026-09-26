import type { DatabaseTransaction } from '../db/client.js'
import { organizationGroupAssignments, type OrganizationGroupRuleSource } from '../db/schema.js'
import {
  appendOrganizationAuditEvent,
  appendOrganizationRuleAuditEvent,
  type OrganizationAuditInput,
} from './audit.js'
import type { EffectivePermissionIdentity } from './permission-catalog-policy.js'

export interface GroupAuditSource {
  readonly sourceKind: OrganizationGroupRuleSource
  readonly sourceId: string
  readonly roleRevision: string | null
  readonly validUntil: Date | null
}

export interface GroupAuditInput {
  eventType: 'group.assigned' | 'group.revoked' | 'group.refreshed'
  actorType: 'user' | 'system'
  actorId: string | null
  assignment: typeof organizationGroupAssignments.$inferSelect
  reason: string
  outcome: 'granted' | 'revoked' | 'transitioned'
  now: Date
  effectivePermissions?: readonly EffectivePermissionIdentity[]
  sources?: readonly GroupAuditSource[]
}

export function appendGroupAudit(
  transaction: DatabaseTransaction,
  organization: { organizationVersion: number; policyVersion: number },
  input: GroupAuditInput,
) {
  const audit = groupAuditInput(organization, input)
  if (input.assignment.assignmentSource === 'rule') {
    return appendOrganizationRuleAuditEvent(
      transaction,
      audit,
      input.sources ?? [],
      input.effectivePermissions ?? [],
    )
  }
  return appendOrganizationAuditEvent(transaction, audit)
}

function groupAuditInput(
  organization: { organizationVersion: number; policyVersion: number },
  input: GroupAuditInput,
): OrganizationAuditInput {
  return {
    actorId: input.actorId,
    actorType: input.actorType,
    assignmentId: input.assignment.assignmentId,
    assignmentSource: input.assignment.assignmentSource,
    complianceSource: input.assignment.complianceSource,
    deploymentId: 1,
    entitlementExpiresAt: input.assignment.expiresAt,
    eventType: input.eventType,
    groupId: input.assignment.groupId,
    occurredAt: input.now,
    organizationVersion: organization.organizationVersion,
    outcome: input.outcome,
    policyVersion: organization.policyVersion,
    reason: input.reason,
    resultingPermissions: input.assignment.assignmentSource === 'rule' ? [] : null,
    ruleRevision: input.assignment.ruleRevision,
    subjectId: input.assignment.groupId,
    subjectType: 'group',
    targetUserId: input.assignment.userId,
  }
}
