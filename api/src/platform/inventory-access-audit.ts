import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentModuleSections } from '../db/schema.js'
import {
  appendInventoryAccessDecision,
  type InventoryAccessAuditInput,
} from '../organization/inventory-access-audit.js'
import { lockCurrentOrganization } from '../organization/organization-lock.js'

export type InventoryAuditDecision = Pick<
  InventoryAccessAuditInput,
  'actorUserId' | 'corporationId' | 'accessKind' | 'decision' | 'reason' | 'subjects'
> & {
  readonly expectedOrganizationVersion?: number
  readonly expectedPolicyVersion?: number
}

export const recordInventoryAccessDecision = async (
  decision: InventoryAuditDecision,
): Promise<void> => {
  await db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction, 'key share')
    if (
      decision.decision === 'allowed' &&
      ((decision.expectedOrganizationVersion !== undefined &&
        decision.expectedOrganizationVersion !== organization.organizationVersion) ||
        (decision.expectedPolicyVersion !== undefined &&
          decision.expectedPolicyVersion !== organization.policyVersion))
    )
      throw new Error('Inventory audit authority changed')
    const [section] = await transaction
      .select({
        disclosureRevision: deploymentModuleSections.disclosureVersion,
        sectionActivationRevision: deploymentModuleSections.activationVersion,
      })
      .from(deploymentModuleSections)
      .where(
        and(
          eq(deploymentModuleSections.moduleId, 'member-audit'),
          eq(deploymentModuleSections.sectionId, 'assets'),
        ),
      )
      .for('share')
    if (
      decision.decision === 'allowed' &&
      (!section ||
        decision.subjects.some(
          (subject) =>
            subject.disclosureRevision !== section.disclosureRevision ||
            subject.sectionActivationRevision !== section.sectionActivationRevision,
        ))
    )
      throw new Error('Inventory audit source authority changed')
    await appendInventoryAccessDecision(transaction, {
      actorUserId: decision.actorUserId,
      corporationId: decision.corporationId,
      accessKind: decision.accessKind,
      decision: decision.decision,
      reason: decision.reason,
      subjects: decision.subjects,
      organizationVersion: decision.expectedOrganizationVersion ?? organization.organizationVersion,
      policyVersion: decision.expectedPolicyVersion ?? organization.policyVersion,
      disclosureRevision: section?.disclosureRevision ?? 0,
      sectionActivationRevision: section?.sectionActivationRevision ?? 0,
    })
  })
}
