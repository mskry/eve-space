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
    targetUserId: z.uuid().nullable(),
    targetCharacterId: z.number().int().positive().nullable(),
    sectionId: z.enum(organizationSensitiveAccessSections),
    decision: z.enum(organizationSensitiveAccessDecisions),
    reason: z.enum(organizationSensitiveAccessReasons),
    organizationVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    disclosureVersion: z.number().int().positive(),
    occurredAt: z.date(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.targetCharacterId !== null && input.targetUserId === null)
      context.addIssue({
        code: 'custom',
        path: ['targetCharacterId'],
        message: 'A character target requires an account target',
      })
    if (
      input.reason === 'target-not-authorized' &&
      (input.targetUserId !== null || input.targetCharacterId !== null)
    )
      context.addIssue({
        code: 'custom',
        path: ['targetUserId'],
        message: 'An unauthorized target identity cannot be retained',
      })
    if (
      (input.decision === 'allowed' &&
        (input.reason !== 'authorized' || input.targetUserId === null)) ||
      (input.decision === 'denied' && input.reason === 'authorized')
    )
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Sensitive access decision and reason do not match',
      })
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
    deploymentId: 1,
    organizationVersion: decision.organizationVersion,
    policyVersion: decision.policyVersion,
    eventType: 'sensitive-access.decided',
    actorType: 'user',
    actorId: decision.actorUserId,
    subjectType: decision.targetUserId ? 'user' : 'deployment',
    subjectId: decision.targetUserId ?? '1',
    reason: decision.reason,
    outcome: decision.decision === 'allowed' ? 'granted' : 'denied',
    targetUserId: decision.targetUserId,
    sectionId: decision.sectionId,
    targetCharacterId: decision.targetCharacterId,
    disclosureVersion: decision.disclosureVersion,
    occurredAt: decision.occurredAt,
  })
}
