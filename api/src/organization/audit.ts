import { z } from 'zod'
import {
  organizationAuditActorTypes,
  organizationAuditEvents,
  organizationAuditEventTypes,
  organizationAuditOutcomes,
  organizationAuditSubjectTypes,
  type OrganizationAuditEventRow,
} from '../db/schema.js'
import type { DomainEventTransaction } from '../domain-events/store.js'

export const organizationAuditInputSchema = z
  .object({
    deploymentId: z.literal(1).default(1),
    organizationVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    eventType: z.enum(organizationAuditEventTypes),
    actorType: z.enum(organizationAuditActorTypes),
    actorId: z.uuid().nullable(),
    subjectType: z.enum(organizationAuditSubjectTypes),
    subjectId: z.string().trim().min(1).max(255),
    reason: z.string().trim().min(1).max(2000),
    outcome: z.enum(organizationAuditOutcomes),
    groupId: z.uuid().nullable().optional(),
    assignmentId: z.uuid().nullable().optional(),
    targetUserId: z.uuid().nullable().optional(),
    assignmentSource: z.enum(['manual', 'compliance']).nullable().optional(),
    complianceSource: z.string().min(1).max(200).nullable().optional(),
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
    if (
      !groupAssignmentEvent &&
      [
        event.groupId,
        event.assignmentId,
        event.targetUserId,
        event.assignmentSource,
        event.complianceSource,
        event.entitlementExpiresAt,
      ].some((value) => value !== undefined && value !== null)
    )
      context.addIssue({
        code: 'custom',
        path: ['groupId'],
        message: 'Group assignment context is not allowed for this event',
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
    subjectId: z.string().min(1).max(255),
    reason: z.string().min(1).max(2000),
    outcome: z.enum(organizationAuditOutcomes),
    groupId: z.uuid().nullable(),
    assignmentId: z.uuid().nullable(),
    targetUserId: z.uuid().nullable(),
    assignmentSource: z.enum(['manual', 'compliance']).nullable(),
    complianceSource: z.string().min(1).max(200).nullable(),
    entitlementExpiresAt: z.date().nullable(),
    causationAuditId: z.uuid().nullable(),
    occurredAt: z.date(),
  })
  .strict()

export type OrganizationAuditInput = z.input<typeof organizationAuditInputSchema>

export async function appendOrganizationAuditEvent(
  transaction: DomainEventTransaction,
  input: OrganizationAuditInput,
) {
  const [stored] = await appendOrganizationAuditEvents(transaction, [input])
  if (!stored) throw new Error('Failed to append organization audit event')
  return stored
}

export async function appendOrganizationAuditEvents(
  transaction: DomainEventTransaction,
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
