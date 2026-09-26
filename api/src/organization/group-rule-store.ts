import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  organizationAuditEvents,
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationGroupRuleAttestations,
  organizationManagedMemberLifecycles,
  organizationGroupRuleReconciliation,
  organizationGroupRules,
  organizationGroups,
  organizationPermissionBundles,
  organizationRuleAuditPermissions,
} from '../db/schema.js'
import { loadEffectiveOrganizationAuthority } from './effective-authority.js'
import { OrganizationGroupMutationError } from './group-mutation-error.js'
import {
  loadConfiguredRulePermissions,
  loadRuleBundleIds,
  reviseOrganizationRuleInTransaction,
} from './group-rule-revisions.js'
import { getOrganizationGroupPermissionsFromDatabase } from './group-permission-reader.js'
import { lockCurrentOrganization } from './organization-lock.js'
import { evaluateOrganizationRuleAccount } from './rule-evidence.js'
import {
  isRuleCondition,
  organizationRuleRolePredicates,
  type RuleCondition,
  type RuleEligibility,
} from './rule-policy.js'

type Transaction = DatabaseTransaction
type Organization = { readonly organizationVersion: number; readonly policyVersion: number }

const requireRuleOwner = async (
  transaction: Transaction,
  organizationVersion: number,
  actorUserId: string,
) => {
  const authority = await loadEffectiveOrganizationAuthority(
    transaction,
    organizationVersion,
    actorUserId,
    'mutate',
  )
  if (!authority.organizationOwner) {
    throw new OrganizationGroupMutationError('owner-authority-required')
  }
}

const validatedCondition = (condition: RuleCondition): RuleCondition => {
  if (!isRuleCondition(condition)) {
    throw new OrganizationGroupMutationError('invalid-rule-condition')
  }
  return condition
}

const validatedBundles = async (
  transaction: Transaction,
  organizationVersion: number,
  requested: readonly string[],
) => {
  const bundleIds = [...new Set(requested)]
  if (bundleIds.length === 0 || bundleIds.length > 50 || bundleIds.length !== requested.length) {
    throw new OrganizationGroupMutationError('bundle-not-found')
  }
  const rows = await transaction
    .select({ bundleId: organizationPermissionBundles.bundleId })
    .from(organizationPermissionBundles)
    .where(
      and(
        eq(organizationPermissionBundles.deploymentId, 1),
        eq(organizationPermissionBundles.organizationVersion, organizationVersion),
        inArray(organizationPermissionBundles.bundleId, bundleIds),
      ),
    )
  if (rows.length !== bundleIds.length) {
    throw new OrganizationGroupMutationError('bundle-not-found')
  }
  return bundleIds.toSorted((left, right) => left.localeCompare(right))
}

const replaceRuleBundles = async (
  transaction: Transaction,
  organizationVersion: number,
  groupId: string,
  bundleIds: readonly string[],
) => {
  await transaction
    .delete(organizationGroupPermissionBundles)
    .where(eq(organizationGroupPermissionBundles.groupId, groupId))
  await transaction.insert(organizationGroupPermissionBundles).values(
    bundleIds.map((bundleId) => ({
      bundleId,
      deploymentId: 1,
      groupId,
      organizationVersion,
    })),
  )
}

const loadRuleForUpdate = async (
  transaction: Transaction,
  organizationVersion: number,
  groupId: string,
) => {
  const [rule] = await transaction
    .select()
    .from(organizationGroupRules)
    .where(
      and(
        eq(organizationGroupRules.groupId, groupId),
        eq(organizationGroupRules.deploymentId, 1),
        eq(organizationGroupRules.organizationVersion, organizationVersion),
      ),
    )
    .for('update')
  if (!rule) {
    throw new OrganizationGroupMutationError('rule-not-found')
  }
  return rule
}

const requireInScopeRuleTarget = async (
  transaction: Transaction,
  organizationVersion: number,
  targetUserId: string,
) => {
  const [target] = await transaction
    .select({ userId: organizationManagedMemberLifecycles.userId })
    .from(organizationManagedMemberLifecycles)
    .where(
      and(
        eq(organizationManagedMemberLifecycles.deploymentId, 1),
        eq(organizationManagedMemberLifecycles.organizationVersion, organizationVersion),
        eq(organizationManagedMemberLifecycles.userId, targetUserId),
        isNull(organizationManagedMemberLifecycles.endedAt),
      ),
    )
  if (!target) {
    throw new OrganizationGroupMutationError('target-not-found')
  }
}

const previewEvidence = (outcome: RuleEligibility['outcome']) => {
  if (outcome === 'eligible') {
    return { reason: 'current-condition-satisfied', evidenceStatus: 'fresh' }
  }
  if (outcome === 'unavailable') {
    return { reason: 'evidence-unavailable', evidenceStatus: 'unavailable' }
  }
  return { reason: 'condition-not-met', evidenceStatus: 'not-eligible' }
}

export const createOrganizationGroupRule = async (input: {
  readonly actorUserId: string
  readonly name: string
  readonly bundleIds: string[]
  readonly condition: RuleCondition
  readonly enabled: boolean
  readonly reason: string
}) =>
  db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireRuleOwner(transaction, organization.organizationVersion, input.actorUserId)
    const condition = validatedCondition(input.condition)
    const bundleIds = await validatedBundles(
      transaction,
      organization.organizationVersion,
      input.bundleIds,
    )
    const [existing] = await transaction
      .select({ groupId: organizationGroups.groupId })
      .from(organizationGroups)
      .where(
        and(
          eq(organizationGroups.deploymentId, 1),
          eq(organizationGroups.organizationVersion, organization.organizationVersion),
          sql`lower(${organizationGroups.name}) = ${input.name.toLowerCase()}`,
        ),
      )
    if (existing) {
      throw new OrganizationGroupMutationError('group-name-conflict')
    }
    const [group] = await transaction
      .insert(organizationGroups)
      .values({
        createdByUserId: input.actorUserId,
        deploymentId: 1,
        managementMode: 'rule',
        name: input.name,
        organizationVersion: organization.organizationVersion,
        restricted: true,
        complianceSource: null,
      })
      .returning()
    if (!group) {
      throw new Error('Failed to create rule-managed group')
    }
    await replaceRuleBundles(
      transaction,
      organization.organizationVersion,
      group.groupId,
      bundleIds,
    )
    const [rule] = await transaction
      .insert(organizationGroupRules)
      .values({
        conditionKind: condition.kind,
        deploymentId: 1,
        enabled: input.enabled,
        groupId: group.groupId,
        organizationVersion: organization.organizationVersion,
        predicateKey: condition.kind === 'corporation-role' ? condition.predicate : null,
        revision: 1,
        updatedByUserId: input.actorUserId,
      })
      .returning()
    await reviseOrganizationRuleInTransaction(transaction, organization, rule!, {
      actorUserId: input.actorUserId,
      conditionKind: condition.kind,
      enabled: input.enabled,
      eventType: 'group-rule.created',
      predicateKey: condition.kind === 'corporation-role' ? condition.predicate : null,
      reason: input.reason,
    })
    return {
      groupId: group.groupId,
      organizationVersion: organization.organizationVersion,
      revision: 1,
    }
  })

export const reviseOrganizationGroupRule = async (input: {
  readonly actorUserId: string
  readonly groupId: string
  readonly expectedRevision: number
  readonly condition: RuleCondition
  readonly enabled: boolean
  readonly bundleIds: string[]
  readonly reason: string
}) =>
  db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireRuleOwner(transaction, organization.organizationVersion, input.actorUserId)
    const rule = await loadRuleForUpdate(
      transaction,
      organization.organizationVersion,
      input.groupId,
    )
    if (rule.revision !== input.expectedRevision) {
      throw new OrganizationGroupMutationError('rule-revision-conflict')
    }
    const condition = validatedCondition(input.condition)
    const bundleIds = await validatedBundles(
      transaction,
      organization.organizationVersion,
      input.bundleIds,
    )
    const currentBundleIds = await loadRuleBundleIds(
      transaction,
      organization.organizationVersion,
      rule.groupId,
    )
    if (
      rule.conditionKind === condition.kind &&
      rule.predicateKey === (condition.kind === 'corporation-role' ? condition.predicate : null) &&
      rule.enabled === input.enabled &&
      currentBundleIds.length === bundleIds.length &&
      currentBundleIds.every((bundleId, index) => bundleId === bundleIds[index])
    ) {
      return {
        groupId: rule.groupId,
        organizationVersion: organization.organizationVersion,
        revision: rule.revision,
      }
    }
    await replaceRuleBundles(transaction, organization.organizationVersion, rule.groupId, bundleIds)
    const revision = await reviseOrganizationRuleInTransaction(transaction, organization, rule, {
      actorUserId: input.actorUserId,
      conditionKind: condition.kind,
      enabled: input.enabled,
      eventType: input.enabled ? 'group-rule.updated' : 'group-rule.disabled',
      predicateKey: condition.kind === 'corporation-role' ? condition.predicate : null,
      reason: input.reason,
    })
    return {
      groupId: rule.groupId,
      organizationVersion: organization.organizationVersion,
      revision,
    }
  })

export const disableOrganizationGroupRule = async (input: {
  readonly actorUserId: string
  readonly groupId: string
  readonly expectedRevision: number
  readonly reason: string
}) =>
  db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireRuleOwner(transaction, organization.organizationVersion, input.actorUserId)
    const rule = await loadRuleForUpdate(
      transaction,
      organization.organizationVersion,
      input.groupId,
    )
    if (rule.revision !== input.expectedRevision) {
      throw new OrganizationGroupMutationError('rule-revision-conflict')
    }
    if (!rule.enabled) {
      return {
        groupId: rule.groupId,
        organizationVersion: organization.organizationVersion,
        revision: rule.revision,
      }
    }
    const revision = await reviseOrganizationRuleInTransaction(transaction, organization, rule, {
      actorUserId: input.actorUserId,
      conditionKind: rule.conditionKind,
      enabled: false,
      eventType: 'group-rule.disabled',
      predicateKey: rule.predicateKey,
      reason: input.reason,
    })
    return {
      groupId: rule.groupId,
      organizationVersion: organization.organizationVersion,
      revision,
    }
  })

export const listOrganizationGroupRules = async (actorUserId: string) =>
  db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireRuleOwner(transaction, organization.organizationVersion, actorUserId)
    const rules = await transaction
      .select({
        conditionKind: organizationGroupRules.conditionKind,
        enabled: organizationGroupRules.enabled,
        groupId: organizationGroupRules.groupId,
        name: organizationGroups.name,
        predicateKey: organizationGroupRules.predicateKey,
        revision: organizationGroupRules.revision,
        completedAt: organizationGroupRuleReconciliation.completedAt,
      })
      .from(organizationGroupRules)
      .innerJoin(organizationGroups, eq(organizationGroups.groupId, organizationGroupRules.groupId))
      .leftJoin(
        organizationGroupRuleReconciliation,
        eq(organizationGroupRuleReconciliation.groupId, organizationGroupRules.groupId),
      )
      .where(eq(organizationGroupRules.organizationVersion, organization.organizationVersion))
      .orderBy(asc(organizationGroups.name), asc(organizationGroupRules.groupId))
    const memberships =
      rules.length > 0
        ? await transaction
            .select({
              bundleId: organizationGroupPermissionBundles.bundleId,
              groupId: organizationGroupPermissionBundles.groupId,
            })
            .from(organizationGroupPermissionBundles)
            .where(
              inArray(
                organizationGroupPermissionBundles.groupId,
                rules.map(({ groupId }) => groupId),
              ),
            )
            .orderBy(asc(organizationGroupPermissionBundles.bundleId))
        : []
    return {
      organizationVersion: organization.organizationVersion,
      rules: rules.map((rule) => ({
        completedAt: rule.completedAt,
        conditionKind: rule.conditionKind,
        enabled: rule.enabled,
        groupId: rule.groupId,
        name: rule.name,
        predicateKey: rule.predicateKey,
        revision: rule.revision,
        bundleIds: memberships
          .filter((entry) => entry.groupId === rule.groupId)
          .map(({ bundleId }) => bundleId),
      })),
    }
  })

export const previewOrganizationGroupRule = async (input: {
  readonly actorUserId: string
  readonly targetUserId: string
  readonly condition: RuleCondition
  readonly bundleIds: string[]
  readonly permissionOffset?: number
}) =>
  db.transaction(async (transaction) => {
    const organization: Organization = await lockCurrentOrganization(transaction)
    await requireRuleOwner(transaction, organization.organizationVersion, input.actorUserId)
    const condition = validatedCondition(input.condition)
    const bundleIds = await validatedBundles(
      transaction,
      organization.organizationVersion,
      input.bundleIds,
    )
    await requireInScopeRuleTarget(
      transaction,
      organization.organizationVersion,
      input.targetUserId,
    )
    const [eligibility, permissions] = await Promise.all([
      evaluateOrganizationRuleAccount(transaction, {
        condition,
        organizationVersion: organization.organizationVersion,
        userId: input.targetUserId,
      }),
      loadConfiguredRulePermissions(transaction, organization.organizationVersion, bundleIds),
    ])
    const permissionOffset = Math.max(0, input.permissionOffset ?? 0)
    return {
      outcome: eligibility.outcome,
      ...previewEvidence(eligibility.outcome),
      sourceCount: eligibility.contributors.length,
      sources: eligibility.contributors.slice(0, 20).map((source) => ({
        kind: source.kind,
        sourceId: source.sourceId,
        validUntil: source.freshUntil?.toISOString() ?? null,
      })),
      sourcesTruncated: eligibility.contributors.length > 20,
      permissions: permissions.slice(permissionOffset, permissionOffset + 100),
      permissionCount: permissions.length,
      nextPermissionOffset:
        permissionOffset + 100 < permissions.length ? permissionOffset + 100 : null,
    }
  })

export const organizationRuleConditionCatalog = () => ({
  conditions: ['registration-compliant', 'director-audience', 'corporation-role'] as const,
  corporationRoles: organizationRuleRolePredicates.map((predicate) => ({
    predicate,
    location: 'roles' as const,
  })),
})

export const getOrganizationRuleMemberSummary = async (input: {
  readonly actorUserId: string
  readonly groupId: string
  readonly userId: string
  readonly permissionOffset?: number
}) =>
  db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireRuleOwner(transaction, organization.organizationVersion, input.actorUserId)
    const rule = await loadRuleForUpdate(
      transaction,
      organization.organizationVersion,
      input.groupId,
    )
    await requireInScopeRuleTarget(transaction, organization.organizationVersion, input.userId)
    const [assignment] = await transaction
      .select({
        assignmentId: organizationGroupAssignments.assignmentId,
        expiresAt: organizationGroupAssignments.expiresAt,
        ruleRevision: organizationGroupAssignments.ruleRevision,
      })
      .from(organizationGroupAssignments)
      .where(
        and(
          eq(organizationGroupAssignments.deploymentId, 1),
          eq(organizationGroupAssignments.organizationVersion, organization.organizationVersion),
          eq(organizationGroupAssignments.groupId, rule.groupId),
          eq(organizationGroupAssignments.userId, input.userId),
          isNull(organizationGroupAssignments.revokedAt),
        ),
      )
    const sources = assignment
      ? await transaction
          .select({
            sourceId: organizationGroupRuleAttestations.sourceId,
            sourceKind: organizationGroupRuleAttestations.sourceKind,
            roleRevision: organizationGroupRuleAttestations.roleRevision,
            executorRevision: organizationGroupRuleAttestations.executorRevision,
            validUntil: organizationGroupRuleAttestations.validUntil,
          })
          .from(organizationGroupRuleAttestations)
          .where(eq(organizationGroupRuleAttestations.assignmentId, assignment.assignmentId))
          .orderBy(
            asc(organizationGroupRuleAttestations.sourceKind),
            asc(organizationGroupRuleAttestations.sourceId),
          )
          .limit(21)
      : []
    const effective = await getOrganizationGroupPermissionsFromDatabase(
      transaction,
      input.userId,
      new Date(),
      organization.organizationVersion,
    )
    return {
      assignment: assignment
        ? {
            assignmentId: assignment.assignmentId,
            ruleRevision: assignment.ruleRevision,
            expiresAt: assignment.expiresAt?.toISOString() ?? null,
            currentRule: assignment.ruleRevision === rule.revision && rule.enabled,
          }
        : null,
      sourceMetadata: sources.slice(0, 20).map((source) => ({
        sourceId: source.sourceId,
        sourceKind: source.sourceKind,
        roleRevision: source.roleRevision,
        executorRevision: source.executorRevision,
        validUntil: source.validUntil.toISOString(),
      })),
      sourcesTruncated: sources.length > 20,
      effectivePermissions: effective.identities.slice(
        input.permissionOffset ?? 0,
        (input.permissionOffset ?? 0) + 100,
      ),
      permissionCount: effective.identities.length,
      nextPermissionOffset:
        (input.permissionOffset ?? 0) + 100 < effective.identities.length
          ? (input.permissionOffset ?? 0) + 100
          : null,
    }
  })

export const listOrganizationRuleAuditPermissions = async (input: {
  readonly actorUserId: string
  readonly auditId: string
  readonly afterPermissionId?: string
}) =>
  db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireRuleOwner(transaction, organization.organizationVersion, input.actorUserId)
    const [audit] = await transaction
      .select({ auditId: organizationAuditEvents.auditId })
      .from(organizationAuditEvents)
      .where(
        and(
          eq(organizationAuditEvents.auditId, input.auditId),
          eq(organizationAuditEvents.organizationVersion, organization.organizationVersion),
          gt(organizationAuditEvents.ruleRevision, 0),
        ),
      )
    if (!audit) {
      throw new OrganizationGroupMutationError('rule-not-found')
    }
    const rows = await transaction
      .select()
      .from(organizationRuleAuditPermissions)
      .where(
        and(
          eq(organizationRuleAuditPermissions.auditId, audit.auditId),
          input.afterPermissionId
            ? gt(organizationRuleAuditPermissions.permissionId, input.afterPermissionId)
            : undefined,
        ),
      )
      .orderBy(asc(organizationRuleAuditPermissions.permissionId))
      .limit(51)
    return {
      permissions: rows.slice(0, 50),
      nextAfterPermissionId: rows.length > 50 ? rows[49]!.permissionId : null,
    }
  })
