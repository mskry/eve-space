import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentModules,
  deploymentModuleSections,
  type OrganizationSensitiveAccessReason,
  type OrganizationSensitiveAccessSection,
} from '../db/schema.js'
import { lockCurrentOrganization } from '../organization/organization-lock.js'
import { appendOrganizationSensitiveAccessDecision } from '../organization/sensitive-access-audit.js'

interface ModuleSensitiveAccessDecision {
  readonly actorUserId: string
  readonly moduleId: string
  readonly sectionId: OrganizationSensitiveAccessSection
  readonly organizationVersion: number
  readonly decision: 'allowed' | 'denied'
  readonly reason: OrganizationSensitiveAccessReason
  readonly targetUserId: string | null
  readonly targetCharacterId: number | null
  readonly occurredAt?: Date
}

export async function recordModuleSensitiveAccessDecision(input: ModuleSensitiveAccessDecision) {
  await db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction, 'key share')
    if (organization.organizationVersion !== input.organizationVersion) {
      throw new Error('Sensitive access organization changed before audit recording')
    }

    const [section] = await transaction
      .select({ disclosureVersion: deploymentModuleSections.disclosureVersion })
      .from(deploymentModules)
      .innerJoin(
        deploymentModuleSections,
        eq(deploymentModuleSections.moduleId, deploymentModules.moduleId),
      )
      .where(
        and(
          eq(deploymentModules.moduleId, input.moduleId),
          eq(deploymentModules.enabled, true),
          eq(deploymentModuleSections.sectionId, input.sectionId),
          eq(deploymentModuleSections.kind, 'sensitive-evidence'),
          eq(deploymentModuleSections.enabled, true),
        ),
      )
    if (!section || section.disclosureVersion < 1) {
      throw new Error('Sensitive access section changed before audit recording')
    }

    await appendOrganizationSensitiveAccessDecision(transaction, {
      actorUserId: input.actorUserId,
      decision: input.decision,
      disclosureVersion: section.disclosureVersion,
      occurredAt: input.occurredAt ?? new Date(),
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      reason: input.reason,
      sectionId: input.sectionId,
      targetCharacterId: input.targetCharacterId,
      targetUserId: input.targetUserId,
    })
  })
}
