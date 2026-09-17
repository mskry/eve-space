import { z } from 'zod'
import type { DatabaseTransaction } from '../db/client.js'
import { containsSensitiveText } from '../sensitive-data.js'
import {
  organizationAuditActorTypes,
  organizationAuditEvents,
  organizationAuditEventTypes,
  organizationAuditOutcomes,
  organizationAuditSubjectTypes,
  organizationSensitiveAccessReasons,
  organizationSensitiveAccessSections,
  type OrganizationAuditEventRow,
} from '../db/schema.js'

export const organizationAuditReasonSchema = safeAuditText(2000)

export const organizationAuditInputSchema = z
  .object({
    deploymentId: z.literal(1).default(1),
    organizationVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    eventType: z.enum(organizationAuditEventTypes),
    actorType: z.enum(organizationAuditActorTypes),
    actorId: z.uuid().nullable(),
    subjectType: z.enum(organizationAuditSubjectTypes),
    subjectId: safeAuditText(255),
    reason: organizationAuditReasonSchema,
    outcome: z.enum(organizationAuditOutcomes),
    groupId: z.uuid().nullable().optional(),
    assignmentId: z.uuid().nullable().optional(),
    targetUserId: z.uuid().nullable().optional(),
    sectionId: z.enum(organizationSensitiveAccessSections).nullable().optional(),
    targetCharacterId: z.number().int().positive().nullable().optional(),
    disclosureVersion: z.number().int().positive().nullable().optional(),
    assignmentSource: z.enum(['manual', 'compliance']).nullable().optional(),
    complianceSource: safeAuditText(200).nullable().optional(),
    entitlementExpiresAt: z.date().nullable().optional(),
    causationAuditId: z.uuid().nullable().optional(),
    occurredAt: z.date().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.actorType === 'system' && event.actorId !== null)
      context.addIssue({ code: 'custom', path: ['actorId'], message: 'System actor has no ID' })
    if (event.actorType !== 'system' && event.actorId === null)
      context.addIssue({ code: 'custom', path: ['actorId'], message: 'Actor ID is required' })
    const groupAssignmentEvent =
      event.eventType === 'group.assigned' || event.eventType === 'group.revoked'
    if (
      groupAssignmentEvent &&
      (!event.groupId || !event.assignmentId || !event.targetUserId || !event.assignmentSource)
    )
      context.addIssue({
        code: 'custom',
        path: ['assignmentId'],
        message: 'Group assignment audit context is required',
      })
    if (groupAssignmentEvent && event.assignmentSource === 'compliance' && !event.complianceSource)
      context.addIssue({
        code: 'custom',
        path: ['complianceSource'],
        message: 'Compliance source is required',
      })
    if (groupAssignmentEvent && event.assignmentSource === 'manual' && event.complianceSource)
      context.addIssue({
        code: 'custom',
        path: ['complianceSource'],
        message: 'Manual assignment has no compliance source',
      })
    const sensitiveAccessEvent = event.eventType === 'sensitive-access.decided'
    if (
      groupAssignmentEvent &&
      hasValue(event.sectionId, event.targetCharacterId, event.disclosureVersion)
    )
      context.addIssue({
        code: 'custom',
        path: ['sectionId'],
        message: 'Sensitive access context is not allowed for group events',
      })
    if (sensitiveAccessEvent) validateSensitiveAccessEvent(event, context)
    else if (
      !groupAssignmentEvent &&
      hasValue(
        event.groupId,
        event.assignmentId,
        event.targetUserId,
        event.assignmentSource,
        event.complianceSource,
        event.entitlementExpiresAt,
        event.sectionId,
        event.targetCharacterId,
        event.disclosureVersion,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['eventType'],
        message: 'Event-specific audit context is not allowed for this event',
      })
  })

const organizationAuditEventSchema = z
  .object({
    auditId: z.uuid(),
    auditSequence: z.bigint().positive(),
    deploymentId: z.literal(1),
    organizationVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    eventType: z.enum(organizationAuditEventTypes),
    actorType: z.enum(organizationAuditActorTypes),
    actorId: z.uuid().nullable(),
    subjectType: z.enum(organizationAuditSubjectTypes),
    subjectId: safeAuditText(255),
    reason: organizationAuditReasonSchema,
    outcome: z.enum(organizationAuditOutcomes),
    groupId: z.uuid().nullable(),
    assignmentId: z.uuid().nullable(),
    targetUserId: z.uuid().nullable(),
    sectionId: z.enum(organizationSensitiveAccessSections).nullable(),
    targetCharacterId: z.number().int().positive().nullable(),
    disclosureVersion: z.number().int().positive().nullable(),
    assignmentSource: z.enum(['manual', 'compliance']).nullable(),
    complianceSource: safeAuditText(200).nullable(),
    entitlementExpiresAt: z.date().nullable(),
    causationAuditId: z.uuid().nullable(),
    occurredAt: z.date(),
  })
  .strict()

export type OrganizationAuditInput = z.input<typeof organizationAuditInputSchema>

function validateSensitiveAccessEvent(
  event: z.infer<typeof organizationAuditInputSchema>,
  context: z.RefinementCtx,
) {
  const accessContextInvalid =
    event.actorType !== 'user' ||
    !event.sectionId ||
    !event.disclosureVersion ||
    hasValue(
      event.groupId,
      event.assignmentId,
      event.assignmentSource,
      event.complianceSource,
      event.entitlementExpiresAt,
      event.causationAuditId,
    ) ||
    (event.targetCharacterId !== null &&
      event.targetCharacterId !== undefined &&
      !event.targetUserId)
  const targetMatches = event.targetUserId
    ? event.subjectType === 'user' && event.subjectId === event.targetUserId
    : event.subjectType === 'deployment' && event.subjectId === '1' && !event.targetCharacterId
  const decisionMatches =
    (event.outcome === 'granted' &&
      event.reason === 'authorized' &&
      event.targetUserId !== null &&
      event.targetUserId !== undefined) ||
    (event.outcome === 'denied' &&
      event.reason !== 'authorized' &&
      (organizationSensitiveAccessReasons as readonly string[]).includes(event.reason))
  const retainsUnauthorizedTarget =
    event.reason === 'target-not-authorized' &&
    (event.targetUserId !== null || event.targetCharacterId !== null)
  if (accessContextInvalid || !targetMatches || !decisionMatches || retainsUnauthorizedTarget)
    context.addIssue({
      code: 'custom',
      path: ['eventType'],
      message: 'Sensitive access audit context is invalid',
    })
}

function hasValue(...values: unknown[]) {
  return values.some((value) => value !== undefined && value !== null)
}

export async function appendOrganizationAuditEvent(
  transaction: DatabaseTransaction,
  input: OrganizationAuditInput,
) {
  const [stored] = await appendOrganizationAuditEvents(transaction, [input])
  if (!stored) throw new Error('Failed to append organization audit event')
  return stored
}

export async function appendOrganizationAuditEvents(
  transaction: DatabaseTransaction,
  inputs: OrganizationAuditInput[],
) {
  if (inputs.length === 0) return []
  const events = inputs.map((input) => organizationAuditInputSchema.parse(input))
  const stored = await transaction.insert(organizationAuditEvents).values(events).returning()
  if (stored.length !== events.length) throw new Error('Failed to append organization audit events')
  return stored.map(toOrganizationAuditEvent)
}

function toOrganizationAuditEvent(stored: OrganizationAuditEventRow) {
  return organizationAuditEventSchema.parse(stored)
}

function safeAuditText(maximumLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximumLength)
    .refine((value) => !containsSensitiveText(value), 'Sensitive data is not allowed')
}
