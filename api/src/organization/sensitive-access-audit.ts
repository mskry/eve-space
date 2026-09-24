import { z } from 'zod'
import type { DatabaseTransaction } from '../db/client.js'
import {
  organizationSensitiveAccessReasons,
  organizationSensitiveAccessSections,
} from '../db/schema.js'
import { appendOrganizationAuditEvent } from './audit.js'

export const organizationSensitiveAccessDecisions = ['allowed', 'denied'] as const

export const organizationSensitiveAccessInputSchema = z
  .object({
    actorUserId: z.uuid(),
    decision: z.enum(organizationSensitiveAccessDecisions),
    disclosureVersion: z.number().int().positive(),
    occurredAt: z.date(),
    organizationVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    reason: z.enum(organizationSensitiveAccessReasons),
    sectionId: z.enum(organizationSensitiveAccessSections),
    targetCharacterId: z.number().int().positive().nullable(),
    targetUserId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.targetCharacterId !== null && input.targetUserId === null) {
      context.addIssue({
        code: 'custom',
        message: 'A character target requires an account target',
        path: ['targetCharacterId'],
      })
    }
    if (
      input.reason === 'target-not-authorized' &&
      (input.targetUserId !== null || input.targetCharacterId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An unauthorized target identity cannot be retained',
        path: ['targetUserId'],
      })
    }
    if (
      (input.decision === 'allowed' &&
        (input.reason !== 'authorized' || input.targetUserId === null)) ||
      (input.decision === 'denied' && input.reason === 'authorized')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Sensitive access decision and reason do not match',
        path: ['reason'],
      })
    }
  })

export type OrganizationSensitiveAccessInput = z.input<
  typeof organizationSensitiveAccessInputSchema
>

export async function appendOrganizationSensitiveAccessDecision(
  transaction: DatabaseTransaction,
  input: OrganizationSensitiveAccessInput,
) {
  const decision = organizationSensitiveAccessInputSchema.parse(input)
  return appendOrganizationAuditEvent(transaction, {
    actorId: decision.actorUserId,
    actorType: 'user',
    deploymentId: 1,
    disclosureVersion: decision.disclosureVersion,
    eventType: 'sensitive-access.decided',
    occurredAt: decision.occurredAt,
    organizationVersion: decision.organizationVersion,
    outcome: decision.decision === 'allowed' ? 'granted' : 'denied',
    policyVersion: decision.policyVersion,
    reason: decision.reason,
    sectionId: decision.sectionId,
    subjectId: decision.targetUserId ?? '1',
    subjectType: decision.targetUserId ? 'user' : 'deployment',
    targetCharacterId: decision.targetCharacterId,
    targetUserId: decision.targetUserId,
  })
}
