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
    deploymentId: 1,
    organizationVersion: organization.organizationVersion,
    policyVersion: organization.policyVersion,
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId,
    subjectType: 'group',
    subjectId: input.assignment.groupId,
    reason: input.reason,
    outcome: input.outcome,
    groupId: input.assignment.groupId,
    assignmentId: input.assignment.assignmentId,
    targetUserId: input.assignment.userId,
    assignmentSource: input.assignment.assignmentSource,
    complianceSource: input.assignment.complianceSource,
    entitlementExpiresAt: input.assignment.expiresAt,
    occurredAt: input.now,
  }
}
