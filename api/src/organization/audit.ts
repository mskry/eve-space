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
  organizationRuleAuditSources,
  organizationRuleAuditPermissions,
  organizationGroupRuleSources,
  type OrganizationAuditEventRow,
} from '../db/schema.js'
import type { EffectivePermissionIdentity } from './permission-catalog-policy.js'

export const organizationAuditReasonSchema = safeAuditText(2000)

export const organizationAuditInputSchema = z
  .object({
    actorId: z.uuid().nullable(),
    actorType: z.enum(organizationAuditActorTypes),
    assignmentId: z.uuid().nullable().optional(),
    assignmentSource: z.enum(['manual', 'compliance', 'rule']).nullable().optional(),
    causationAuditId: z.uuid().nullable().optional(),
    complianceSource: safeAuditText(200).nullable().optional(),
    deploymentId: z.literal(1).default(1),
    disclosureVersion: z.number().int().positive().nullable().optional(),
    entitlementExpiresAt: z.date().nullable().optional(),
    eventType: z.enum(organizationAuditEventTypes),
    groupId: z.uuid().nullable().optional(),
    occurredAt: z.date().optional(),
    organizationVersion: z.number().int().positive(),
    outcome: z.enum(organizationAuditOutcomes),
    policyVersion: z.number().int().positive(),
    reason: organizationAuditReasonSchema,
    resultingPermissions: z.array(safeAuditText(200)).max(100).nullable().optional(),
    ruleRevision: z.number().int().positive().nullable().optional(),
    sectionId: z.enum(organizationSensitiveAccessSections).nullable().optional(),
    subjectId: safeAuditText(255),
    subjectType: z.enum(organizationAuditSubjectTypes),
    targetCharacterId: z.number().int().positive().nullable().optional(),
    targetUserId: z.uuid().nullable().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    validateAuditActor(event, context)
    const groupAssignmentEvent =
      event.eventType === 'group.assigned' ||
      event.eventType === 'group.revoked' ||
      event.eventType === 'group.refreshed'
    const ruleMutationEvent = event.eventType.startsWith('group-rule.')
    if (groupAssignmentEvent) {
      validateGroupAuditContext(event, context)
    } else if (ruleMutationEvent) {
      validateRuleMutationAuditContext(event, context)
    } else if (event.eventType === 'sensitive-access.decided') {
      validateSensitiveAccessEvent(event, context)
    } else if (hasAuditContext(event)) {
      context.addIssue({
        code: 'custom',
        message: 'Event-specific audit context is not allowed for this event',
        path: ['eventType'],
      })
    }
  })

const hasAuditContext = (event: z.infer<typeof organizationAuditInputSchema>) =>
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
    event.ruleRevision,
    event.resultingPermissions,
  )

const validateGroupAuditContext = (
  event: z.infer<typeof organizationAuditInputSchema>,
  context: z.RefinementCtx,
) => {
  if (!event.groupId || !event.assignmentId || !event.targetUserId || !event.assignmentSource) {
    context.addIssue({
      code: 'custom',
      message: 'Group assignment audit context is required',
      path: ['assignmentId'],
    })
  }
  if (event.assignmentSource === 'compliance' && !event.complianceSource) {
    context.addIssue({
      code: 'custom',
      message: 'Compliance source is required',
      path: ['complianceSource'],
    })
  }
  if (event.assignmentSource === 'manual' && event.complianceSource) {
    context.addIssue({
      code: 'custom',
      message: 'Manual assignment has no compliance source',
      path: ['complianceSource'],
    })
  }
  if (hasValue(event.sectionId, event.targetCharacterId, event.disclosureVersion)) {
    context.addIssue({
      code: 'custom',
      message: 'Sensitive access context is not allowed for group events',
      path: ['sectionId'],
    })
  }
  const ruleContextInvalid =
    event.assignmentSource === 'rule'
      ? Boolean(event.complianceSource) || !event.ruleRevision || !event.resultingPermissions
      : hasValue(event.ruleRevision, event.resultingPermissions)
  if (
    ruleContextInvalid ||
    (event.eventType === 'group.refreshed' && event.assignmentSource !== 'rule')
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Invalid rule assignment audit context',
      path: ['ruleRevision'],
    })
  }
}

const validateRuleMutationAuditContext = (
  event: z.infer<typeof organizationAuditInputSchema>,
  context: z.RefinementCtx,
) => {
  if (
    event.actorType !== 'user' ||
    !event.groupId ||
    event.subjectType !== 'group' ||
    event.subjectId !== event.groupId ||
    !event.ruleRevision ||
    !event.resultingPermissions ||
    hasValue(
      event.assignmentId,
      event.targetUserId,
      event.assignmentSource,
      event.complianceSource,
      event.entitlementExpiresAt,
      event.sectionId,
      event.targetCharacterId,
      event.disclosureVersion,
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Invalid rule mutation audit context',
      path: ['ruleRevision'],
    })
  }
}

function validateAuditActor(
  event: z.infer<typeof organizationAuditInputSchema>,
  context: z.RefinementCtx,
) {
  if (event.actorType === 'system' && event.actorId !== null) {
    context.addIssue({ code: 'custom', message: 'System actor has no ID', path: ['actorId'] })
  }
  if (event.actorType !== 'system' && event.actorId === null) {
    context.addIssue({ code: 'custom', message: 'Actor ID is required', path: ['actorId'] })
  }
}

const organizationAuditEventSchema = z
  .object({
    actorId: z.uuid().nullable(),
    actorType: z.enum(organizationAuditActorTypes),
    assignmentId: z.uuid().nullable(),
    assignmentSource: z.enum(['manual', 'compliance', 'rule']).nullable(),
    auditId: z.uuid(),
    auditSequence: z.bigint().positive(),
    causationAuditId: z.uuid().nullable(),
    complianceSource: safeAuditText(200).nullable(),
    deploymentId: z.literal(1),
    disclosureVersion: z.number().int().positive().nullable(),
    entitlementExpiresAt: z.date().nullable(),
    eventType: z.enum(organizationAuditEventTypes),
    groupId: z.uuid().nullable(),
    occurredAt: z.date(),
    organizationVersion: z.number().int().positive(),
    outcome: z.enum(organizationAuditOutcomes),
    policyVersion: z.number().int().positive(),
    reason: organizationAuditReasonSchema,
    resultingPermissions: z.array(safeAuditText(200)).nullable(),
    ruleRevision: z.number().int().positive().nullable(),
    sectionId: z.enum(organizationSensitiveAccessSections).nullable(),
    subjectId: safeAuditText(255),
    subjectType: z.enum(organizationAuditSubjectTypes),
    targetCharacterId: z.number().int().positive().nullable(),
    targetUserId: z.uuid().nullable(),
  })
  .strict()

export type OrganizationAuditInput = z.input<typeof organizationAuditInputSchema>

function validateSensitiveAccessEvent(
  event: z.infer<typeof organizationAuditInputSchema>,
  context: z.RefinementCtx,
) {
  const accessContextInvalid = hasInvalidSensitiveAccessContext(event)
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
  if (accessContextInvalid || !targetMatches || !decisionMatches || retainsUnauthorizedTarget) {
    context.addIssue({
      code: 'custom',
      message: 'Sensitive access audit context is invalid',
      path: ['eventType'],
    })
  }
}

function hasInvalidSensitiveAccessContext(event: z.infer<typeof organizationAuditInputSchema>) {
  return (
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
      event.ruleRevision,
      event.resultingPermissions,
    ) ||
    (event.targetCharacterId !== null &&
      event.targetCharacterId !== undefined &&
      !event.targetUserId)
  )
}

function hasValue(...values: unknown[]) {
  return values.some((value) => value !== undefined && value !== null)
}

export async function appendOrganizationAuditEvent(
  transaction: DatabaseTransaction,
  input: OrganizationAuditInput,
) {
  const [stored] = await appendOrganizationAuditEvents(transaction, [input])
  if (!stored) {
    throw new Error('Failed to append organization audit event')
  }
  return stored
}

const ruleAuditSourceSchema = z
  .object({
    roleRevision: z.uuid().nullable(),
    sourceId: z.uuid(),
    sourceKind: z.enum(organizationGroupRuleSources),
    validUntil: z.date().nullable(),
  })
  .strict()
  .refine((source) =>
    source.sourceKind === 'registration' || source.sourceKind === 'explicit-director'
      ? source.roleRevision === null
      : source.roleRevision !== null,
  )

const ruleAuditPermissionSchema = z
  .object({
    type: z.enum(['service', 'module']),
    key: safeAuditText(200),
    moduleId: safeAuditText(200).nullable(),
    publisherPackage: safeAuditText(214).nullable(),
  })
  .strict()
  .refine((permission) =>
    permission.type === 'service'
      ? permission.moduleId === null && permission.publisherPackage === null
      : permission.moduleId !== null && permission.publisherPackage !== null,
  )

export const appendOrganizationRuleAuditEvent = async (
  transaction: DatabaseTransaction,
  input: OrganizationAuditInput,
  sources: readonly z.input<typeof ruleAuditSourceSchema>[],
  permissions: readonly EffectivePermissionIdentity[],
) => {
  const event = await appendOrganizationAuditEvent(transaction, input)
  if (sources.length > 0) {
    await transaction.insert(organizationRuleAuditSources).values(
      sources.map((source) => ({
        auditId: event.auditId,
        ...ruleAuditSourceSchema.parse(source),
      })),
    )
  }
  if (permissions.length > 0) {
    await transaction.insert(organizationRuleAuditPermissions).values(
      permissions.map((permission) => {
        const parsed = ruleAuditPermissionSchema.parse(permission)
        return {
          auditId: event.auditId,
          permissionKey: parsed.key,
          permissionType: parsed.type,
          moduleId: parsed.moduleId,
          publisherPackage: parsed.publisherPackage,
        }
      }),
    )
  }
  return event
}

export async function appendOrganizationAuditEvents(
  transaction: DatabaseTransaction,
  inputs: OrganizationAuditInput[],
) {
  if (inputs.length === 0) {
    return []
  }
  const events = inputs.map((input) => organizationAuditInputSchema.parse(input))
  const stored = await transaction.insert(organizationAuditEvents).values(events).returning()
  if (stored.length !== events.length) {
    throw new Error('Failed to append organization audit events')
  }
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
