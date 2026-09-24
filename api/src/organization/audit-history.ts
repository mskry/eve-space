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
  if (input.beforeAuditSequence) {
    conditions.push(lt(organizationAuditEvents.auditSequence, input.beforeAuditSequence))
  }

  const rows = await db
    .select({
      actorId: organizationAuditEvents.actorId,
      actorType: organizationAuditEvents.actorType,
      assignmentId: organizationAuditEvents.assignmentId,
      assignmentSource: organizationAuditEvents.assignmentSource,
      auditId: organizationAuditEvents.auditId,
      auditSequence: organizationAuditEvents.auditSequence,
      causationAuditId: organizationAuditEvents.causationAuditId,
      complianceSource: organizationAuditEvents.complianceSource,
      disclosureVersion: organizationAuditEvents.disclosureVersion,
      entitlementExpiresAt: organizationAuditEvents.entitlementExpiresAt,
      eventType: organizationAuditEvents.eventType,
      groupId: organizationAuditEvents.groupId,
      occurredAt: organizationAuditEvents.occurredAt,
      organizationVersion: organizationAuditEvents.organizationVersion,
      outcome: organizationAuditEvents.outcome,
      policyVersion: organizationAuditEvents.policyVersion,
      reason: organizationAuditEvents.reason,
      sectionId: organizationAuditEvents.sectionId,
      subjectId: organizationAuditEvents.subjectId,
      subjectType: organizationAuditEvents.subjectType,
      targetCharacterId: organizationAuditEvents.targetCharacterId,
      targetUserId: organizationAuditEvents.targetUserId,
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
