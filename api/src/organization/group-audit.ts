import type { DatabaseTransaction } from '../db/client.js'
import { organizationGroupAssignments } from '../db/schema.js'
import {
  appendOrganizationAuditEvent,
  appendOrganizationAuditEvents,
  type OrganizationAuditInput,
} from './audit.js'

export interface GroupAuditInput {
  eventType: 'group.assigned' | 'group.revoked'
  actorType: 'user' | 'system'
  actorId: string | null
  assignment: typeof organizationGroupAssignments.$inferSelect
  reason: string
  outcome: 'granted' | 'revoked'
  now: Date
}

export function appendGroupAudit(
  transaction: DatabaseTransaction,
  organization: { organizationVersion: number; policyVersion: number },
  input: GroupAuditInput,
) {
  return appendOrganizationAuditEvent(transaction, groupAuditInput(organization, input))
}

export function appendGroupAudits(
  transaction: DatabaseTransaction,
  organization: { organizationVersion: number; policyVersion: number },
  inputs: GroupAuditInput[],
) {
  return appendOrganizationAuditEvents(
    transaction,
    inputs.map((input) => groupAuditInput(organization, input)),
  )
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
    subjectId: input.assignment.groupId,
    subjectType: 'group',
    targetUserId: input.assignment.userId,
  }
}
