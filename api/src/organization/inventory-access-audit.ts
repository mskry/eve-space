import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DatabaseTransaction } from '../db/client.js'

const subjectSchema = z
  .object({
    userId: z.uuid(),
    characterId: z.number().int().positive(),
    characterLifecycle: z.uuid(),
    memberLifecycle: z.uuid(),
    authorizationGeneration: z.number().int().nonnegative(),
    disclosureRevision: z.number().int().positive(),
    sectionActivationRevision: z.number().int().nonnegative(),
    evidenceReadable: z.boolean(),
  })
  .strict()

export const inventoryAccessAuditSchema = z
  .object({
    actorUserId: z.uuid(),
    organizationVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    corporationId: z.number().int().positive().nullable(),
    accessKind: z.enum(['aggregate', 'holders']),
    decision: z.enum(['allowed', 'denied']),
    reason: z.enum([
      'authorized',
      'scope-denied',
      'permission-denied',
      'authority-changed',
      'source-unavailable',
      'limit',
    ]),
    disclosureRevision: z.number().int().nonnegative(),
    sectionActivationRevision: z.number().int().nonnegative(),
    subjects: z.array(subjectSchema).max(250),
  })
  .strict()
  .refine((input) =>
    input.decision === 'allowed'
      ? input.reason === 'authorized' &&
        input.corporationId !== null &&
        input.disclosureRevision > 0
      : input.reason !== 'authorized' &&
        input.corporationId === null &&
        input.subjects.length === 0,
  )

export type InventoryAccessAuditInput = z.input<typeof inventoryAccessAuditSchema>

export const appendInventoryAccessDecision = async (
  transaction: DatabaseTransaction,
  input: InventoryAccessAuditInput,
) => {
  const decision = inventoryAccessAuditSchema.parse(input)
  const stored = await transaction.execute(sql`
    insert into organization_inventory_access_audit (
      actor_user_id, organization_version, policy_version, corporation_id, access_kind,
      decision, reason, disclosure_revision, section_activation_revision, subjects
    ) values (${decision.actorUserId}, ${decision.organizationVersion}, ${decision.policyVersion},
      ${decision.corporationId}, ${decision.accessKind}, ${decision.decision}, ${decision.reason},
      ${decision.disclosureRevision}, ${decision.sectionActivationRevision}, ${JSON.stringify(decision.subjects)}::jsonb)
    returning audit_id
  `)
  if (stored.length !== 1) throw new Error('Inventory access audit was not persisted')
}
