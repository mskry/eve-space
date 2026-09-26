import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { organizationGroupRuleAttestations } from '../db/schema.js'
import type { RuleEvidenceSource } from './rule-policy.js'

export const toRuleAttestation = (assignmentId: string, source: RuleEvidenceSource) => ({
  affiliationPeriodRevision: source.binding?.affiliationPeriodRevision ?? null,
  assignmentId,
  authorityCorporationId: source.binding?.authorityCorporationId ?? null,
  authorizationGeneration: source.binding?.authorizationGeneration ?? null,
  executorFreshUntil: source.binding?.executorFreshUntil ?? null,
  executorRevision: source.binding?.executorRevision ?? null,
  roleRevision: source.roleRevision,
  sourceId: source.sourceId,
  sourceKind: source.kind,
  subjectLifecycleId: source.binding?.subjectLifecycleId ?? null,
  validUntil: source.freshUntil!,
})

export const toRuleAuditSource = (
  source: Pick<
    typeof organizationGroupRuleAttestations.$inferSelect,
    'sourceKind' | 'sourceId' | 'roleRevision' | 'validUntil'
  >,
) => ({
  sourceKind: source.sourceKind,
  sourceId: source.sourceId,
  roleRevision: source.roleRevision,
  validUntil: source.validUntil,
})

export const loadRuleAttestations = (transaction: DatabaseTransaction, assignmentId: string) =>
  transaction
    .select()
    .from(organizationGroupRuleAttestations)
    .where(eq(organizationGroupRuleAttestations.assignmentId, assignmentId))
    .orderBy(
      asc(organizationGroupRuleAttestations.sourceKind),
      asc(organizationGroupRuleAttestations.sourceId),
    )

export const replaceRuleAttestations = async (
  transaction: DatabaseTransaction,
  assignmentId: string,
  sources: readonly RuleEvidenceSource[],
) => {
  await transaction
    .delete(organizationGroupRuleAttestations)
    .where(eq(organizationGroupRuleAttestations.assignmentId, assignmentId))
  if (sources.length > 0) {
    await transaction
      .insert(organizationGroupRuleAttestations)
      .values(sources.map((source) => toRuleAttestation(assignmentId, source)))
  }
}

export const advanceRuleAttestationAuthorizationGeneration = async (
  transaction: DatabaseTransaction,
  characterId: number,
  authorizationGeneration: number,
  now: Date,
) => {
  await transaction
    .update(organizationGroupRuleAttestations)
    .set({ authorizationGeneration })
    .where(
      and(
        eq(organizationGroupRuleAttestations.authorizationGeneration, authorizationGeneration - 1),
        inArray(organizationGroupRuleAttestations.sourceKind, [
          'corporation-role',
          'derived-director',
        ]),
        sql`exists (
          select 1 from organization_group_assignments assignment
          join character_corporation_role_observations observation
            on observation.organization_version = assignment.organization_version
            and observation.user_id = assignment.user_id
          where assignment.assignment_id = ${organizationGroupRuleAttestations.assignmentId}
            and assignment.revoked_at is null
            and observation.character_id = ${characterId}
            and observation.status = 'fresh'
            and observation.invalidated_at is null
            and observation.fresh_until > ${now.toISOString()}::timestamptz
            and observation.authorization_generation = ${authorizationGeneration}
            and observation.source_subject_lifecycle_id = ${organizationGroupRuleAttestations.subjectLifecycleId}
            and observation.affiliation_period_revision = ${organizationGroupRuleAttestations.affiliationPeriodRevision}
            and observation.authority_corporation_id = ${organizationGroupRuleAttestations.authorityCorporationId}
            and observation.role_revision = ${organizationGroupRuleAttestations.roleRevision}
        )`,
      ),
    )
}
