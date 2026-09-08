import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSettings, organizationAuditEvents } from '../db/schema.js'

const defaultPageSize = 50

export async function listCurrentOrganizationAuditHistory(input: {
  limit?: number
  beforeAuditSequence?: bigint
}) {
  const limit = Math.min(Math.max(input.limit ?? defaultPageSize, 1), 100)
  const conditions = [
    eq(organizationAuditEvents.deploymentId, deploymentSettings.id),
    eq(organizationAuditEvents.organizationVersion, deploymentSettings.organizationVersion),
    eq(deploymentSettings.id, 1),
  ]
  if (input.beforeAuditSequence)
    conditions.push(lt(organizationAuditEvents.auditSequence, input.beforeAuditSequence))

  const rows = await db
    .select({
      auditId: organizationAuditEvents.auditId,
      auditSequence: organizationAuditEvents.auditSequence,
      organizationVersion: organizationAuditEvents.organizationVersion,
      policyVersion: organizationAuditEvents.policyVersion,
      eventType: organizationAuditEvents.eventType,
      actorType: organizationAuditEvents.actorType,
      actorId: organizationAuditEvents.actorId,
      subjectType: organizationAuditEvents.subjectType,
      subjectId: organizationAuditEvents.subjectId,
      reason: organizationAuditEvents.reason,
      outcome: organizationAuditEvents.outcome,
      groupId: organizationAuditEvents.groupId,
      assignmentId: organizationAuditEvents.assignmentId,
      targetUserId: organizationAuditEvents.targetUserId,
      assignmentSource: organizationAuditEvents.assignmentSource,
      complianceSource: organizationAuditEvents.complianceSource,
      entitlementExpiresAt: organizationAuditEvents.entitlementExpiresAt,
      causationAuditId: organizationAuditEvents.causationAuditId,
      occurredAt: organizationAuditEvents.occurredAt,
    })
    .from(organizationAuditEvents)
    .innerJoin(deploymentSettings, and(...conditions))
    .orderBy(desc(organizationAuditEvents.auditSequence))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  return {
    events: page.map((event) => ({
      ...event,
      auditSequence: event.auditSequence.toString(),
      entitlementExpiresAt: event.entitlementExpiresAt?.toISOString() ?? null,
      occurredAt: event.occurredAt.toISOString(),
    })),
    nextBeforeAuditSequence:
      rows.length > limit ? (page.at(-1)?.auditSequence.toString() ?? null) : null,
  }
}
