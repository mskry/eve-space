import { and, asc, eq } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  organizationGroupAssignments,
  organizationGroupRules,
  users,
  type OrganizationGroupAssignmentRow,
  type OrganizationGroupRow,
} from '../db/schema.js'
import {
  loadCurrentGroupForUpdate,
  loadUnrevokedGroupAssignmentForUpdate,
  revokeGroupAssignmentRecord,
} from './group-assignment-store.js'
import { appendGroupAudit, type GroupAuditSource } from './group-audit.js'
import { getOrganizationGroupPermissionsFromDatabase } from './group-permission-reader.js'
import {
  loadRuleAttestations,
  replaceRuleAttestations,
  toRuleAuditSource,
  toRuleAttestation,
} from './group-rule-attestation-store.js'
import { evaluateOrganizationRuleAccount } from './rule-evidence.js'
import { isRuleCondition, type RuleEvidenceSource } from './rule-policy.js'

type RuleRow = typeof organizationGroupRules.$inferSelect
type Organization = { readonly organizationVersion: number; readonly policyVersion: number }
const compareSourceSignatures = (left: string, right: string) => left.localeCompare(right)

const lockRuleAccount = async (transaction: DatabaseTransaction, userId: string) => {
  await transaction.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
}

const sourceSignature = (source: ReturnType<typeof toRuleAttestation>) =>
  JSON.stringify({
    affiliationPeriodRevision: source.affiliationPeriodRevision,
    authorityCorporationId: source.authorityCorporationId,
    authorizationGeneration: source.authorizationGeneration,
    executorFreshUntil: source.executorFreshUntil?.toISOString() ?? null,
    executorRevision: source.executorRevision,
    roleRevision: source.roleRevision,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    subjectLifecycleId: source.subjectLifecycleId,
    validUntil: source.validUntil.toISOString(),
  })

const sameAttestations = (
  existing: Awaited<ReturnType<typeof loadRuleAttestations>>,
  assignmentId: string,
  sources: readonly RuleEvidenceSource[],
) => {
  const current = existing.map(sourceSignature).toSorted(compareSourceSignatures)
  const desired = sources
    .map((source) => sourceSignature(toRuleAttestation(assignmentId, source)))
    .toSorted(compareSourceSignatures)
  return (
    current.length === desired.length && current.every((value, index) => value === desired[index])
  )
}

const auditSources = (sources: readonly RuleEvidenceSource[]): GroupAuditSource[] =>
  sources.map((source) => ({
    sourceKind: source.kind,
    sourceId: source.sourceId,
    roleRevision: source.roleRevision,
    validUntil: source.freshUntil,
  }))

const revokeRuleAssignment = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  existing: OrganizationGroupAssignmentRow,
  reason: string,
  now: Date,
) => {
  const sources = await loadRuleAttestations(transaction, existing.assignmentId)
  const revoked = await revokeGroupAssignmentRecord(transaction, existing.assignmentId, {
    actorType: 'system',
    actorUserId: null,
    reason,
    now,
  })
  const effective = await getOrganizationGroupPermissionsFromDatabase(
    transaction,
    existing.userId,
    now,
    organization.organizationVersion,
  )
  await appendGroupAudit(transaction, organization, {
    actorId: null,
    actorType: 'system',
    assignment: revoked,
    eventType: 'group.revoked',
    now,
    outcome: 'revoked',
    reason,
    effectivePermissions: effective.identities,
    sources: sources.map(toRuleAuditSource),
  })
}

const createRuleAssignment = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  rule: RuleRow,
  userId: string,
  sources: readonly RuleEvidenceSource[],
  now: Date,
) => {
  const expiresAt = new Date(Math.max(...sources.map((source) => source.freshUntil!.getTime())))
  const [assignment] = await transaction
    .insert(organizationGroupAssignments)
    .values({
      assignedActorType: 'system',
      assignedAt: now,
      assignedByUserId: null,
      assignmentSource: 'rule',
      complianceSource: null,
      deploymentId: 1,
      expiresAt,
      groupId: rule.groupId,
      organizationVersion: organization.organizationVersion,
      reason: 'Current automatic rule conditions established.',
      ruleRevision: rule.revision,
      userId,
    })
    .returning()
  if (!assignment) {
    throw new Error('Failed to create rule-managed group assignment')
  }
  await replaceRuleAttestations(transaction, assignment.assignmentId, sources)
  const effective = await getOrganizationGroupPermissionsFromDatabase(
    transaction,
    userId,
    now,
    organization.organizationVersion,
  )
  await appendGroupAudit(transaction, organization, {
    actorId: null,
    actorType: 'system',
    assignment,
    eventType: 'group.assigned',
    now,
    outcome: 'granted',
    reason: assignment.reason,
    effectivePermissions: effective.identities,
    sources: auditSources(sources),
  })
}

const renewRuleAssignment = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  existing: OrganizationGroupAssignmentRow,
  sources: readonly RuleEvidenceSource[],
  now: Date,
) => {
  const attestations = await loadRuleAttestations(transaction, existing.assignmentId)
  const expiresAt = new Date(Math.max(...sources.map((source) => source.freshUntil!.getTime())))
  if (
    existing.expiresAt?.getTime() === expiresAt.getTime() &&
    sameAttestations(attestations, existing.assignmentId, sources)
  ) {
    return false
  }
  const [assignment] = await transaction
    .update(organizationGroupAssignments)
    .set({ expiresAt, updatedAt: now })
    .where(eq(organizationGroupAssignments.assignmentId, existing.assignmentId))
    .returning()
  if (!assignment) {
    throw new Error('Failed to renew rule-managed group assignment')
  }
  await replaceRuleAttestations(transaction, assignment.assignmentId, sources)
  const effective = await getOrganizationGroupPermissionsFromDatabase(
    transaction,
    existing.userId,
    now,
    organization.organizationVersion,
  )
  await appendGroupAudit(transaction, organization, {
    actorId: null,
    actorType: 'system',
    assignment,
    eventType: 'group.refreshed',
    now,
    outcome: 'transitioned',
    reason: 'Current automatic rule evidence changed.',
    effectivePermissions: effective.identities,
    sources: auditSources(sources),
  })
  return true
}

const convergeOneRule = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  rule: RuleRow,
  userId: string,
  now: Date,
) => {
  const group: OrganizationGroupRow = await loadCurrentGroupForUpdate(
    transaction,
    organization.organizationVersion,
    rule.groupId,
  )
  if (group.managementMode !== 'rule') {
    throw new Error('Rule group management changed')
  }
  const existing = await loadUnrevokedGroupAssignmentForUpdate(
    transaction,
    organization.organizationVersion,
    group.groupId,
    userId,
  )
  const condition =
    rule.conditionKind === 'corporation-role'
      ? { kind: rule.conditionKind, predicate: rule.predicateKey }
      : { kind: rule.conditionKind }
  if (!isRuleCondition(condition)) {
    throw new Error('Rule contains an unsupported condition')
  }
  const eligibility = rule.enabled
    ? await evaluateOrganizationRuleAccount(transaction, {
        organizationVersion: organization.organizationVersion,
        userId,
        condition,
        now,
      })
    : { outcome: 'ineligible' as const, contributors: [] as const }
  if (
    existing &&
    (eligibility.outcome !== 'eligible' ||
      existing.ruleRevision !== rule.revision ||
      existing.expiresAt === null ||
      existing.expiresAt <= now)
  ) {
    await revokeRuleAssignment(
      transaction,
      organization,
      existing,
      'Automatic rule no longer supports this assignment.',
      now,
    )
  }
  if (eligibility.outcome !== 'eligible') {
    return
  }
  if (existing?.ruleRevision === rule.revision && existing.expiresAt && existing.expiresAt > now) {
    await renewRuleAssignment(transaction, organization, existing, eligibility.contributors, now)
    return
  }
  await createRuleAssignment(transaction, organization, rule, userId, eligibility.contributors, now)
}

export const convergeRuleManagedGroupsForAccountInTransaction = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  userId: string,
  now = new Date(),
) => {
  await lockRuleAccount(transaction, userId)
  const rules = await transaction
    .select()
    .from(organizationGroupRules)
    .where(
      and(
        eq(organizationGroupRules.deploymentId, 1),
        eq(organizationGroupRules.organizationVersion, organization.organizationVersion),
      ),
    )
    .orderBy(asc(organizationGroupRules.groupId))
    .for('update')
  /* oxlint-disable no-await-in-loop -- Rule and group locks follow deterministic group order. */
  for (const rule of rules) {
    await convergeOneRule(transaction, organization, rule, userId, now)
  }
  /* oxlint-enable no-await-in-loop */
}

export const convergeRuleManagedGroupForAccountInTransaction = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  groupId: string,
  userId: string,
  now = new Date(),
) => {
  await lockRuleAccount(transaction, userId)
  const [rule] = await transaction
    .select()
    .from(organizationGroupRules)
    .where(
      and(
        eq(organizationGroupRules.groupId, groupId),
        eq(organizationGroupRules.deploymentId, 1),
        eq(organizationGroupRules.organizationVersion, organization.organizationVersion),
      ),
    )
    .for('update')
  if (rule) {
    await convergeOneRule(transaction, organization, rule, userId, now)
  }
}
