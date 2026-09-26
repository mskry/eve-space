import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { appendDomainEvent } from '../domain-events/store.js'
import {
  organizationGroupPermissionBundles,
  organizationGroupRuleReconciliation,
  organizationGroupRuleRevisions,
  organizationGroupRules,
  organizationPermissionBundleEntries,
} from '../db/schema.js'
import { appendOrganizationRuleAuditEvent } from './audit.js'
import type { EffectivePermissionIdentity } from './permission-catalog-policy.js'

type Rule = typeof organizationGroupRules.$inferSelect
type Organization = { readonly organizationVersion: number; readonly policyVersion: number }

export const loadRuleBundleIds = async (
  transaction: DatabaseTransaction,
  organizationVersion: number,
  groupId: string,
) => {
  const bundles = await transaction
    .select({ bundleId: organizationGroupPermissionBundles.bundleId })
    .from(organizationGroupPermissionBundles)
    .where(
      and(
        eq(organizationGroupPermissionBundles.deploymentId, 1),
        eq(organizationGroupPermissionBundles.organizationVersion, organizationVersion),
        eq(organizationGroupPermissionBundles.groupId, groupId),
      ),
    )
    .orderBy(asc(organizationGroupPermissionBundles.bundleId))
  return bundles.map(({ bundleId }) => bundleId)
}

export const loadConfiguredRulePermissions = async (
  transaction: DatabaseTransaction,
  organizationVersion: number,
  bundleIds: readonly string[],
): Promise<EffectivePermissionIdentity[]> => {
  const rows = await transaction
    .select({
      type: organizationPermissionBundleEntries.permissionType,
      key: organizationPermissionBundleEntries.permissionKey,
      publisherPackage: organizationPermissionBundleEntries.publisherPackage,
      moduleId: organizationPermissionBundleEntries.moduleId,
    })
    .from(organizationPermissionBundleEntries)
    .where(
      and(
        eq(organizationPermissionBundleEntries.deploymentId, 1),
        eq(organizationPermissionBundleEntries.organizationVersion, organizationVersion),
        inArray(organizationPermissionBundleEntries.bundleId, bundleIds),
      ),
    )
  const identities = new Map<string, EffectivePermissionIdentity>()
  for (const row of rows) {
    if (row.type === 'module' && (!row.publisherPackage || !row.moduleId)) {
      continue
    }
    const identity: EffectivePermissionIdentity = {
      ...row,
      moduleId: row.type === 'service' ? null : row.moduleId,
      publisherPackage: row.type === 'service' ? null : row.publisherPackage,
    }
    identities.set(
      [identity.type, identity.publisherPackage, identity.moduleId, identity.key].join('\0'),
      identity,
    )
  }
  return [...identities.values()]
}

export const reviseOrganizationRuleInTransaction = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  rule: Rule,
  input: {
    readonly actorUserId: string
    readonly conditionKind: Rule['conditionKind']
    readonly predicateKey: string | null
    readonly enabled: boolean
    readonly reason: string
    readonly eventType: 'group-rule.created' | 'group-rule.updated' | 'group-rule.disabled'
  },
) => {
  const bundleIds = await loadRuleBundleIds(
    transaction,
    organization.organizationVersion,
    rule.groupId,
  )
  const revision = input.eventType === 'group-rule.created' ? rule.revision : rule.revision + 1
  const now = new Date()
  if (input.eventType !== 'group-rule.created') {
    await transaction
      .update(organizationGroupRules)
      .set({
        conditionKind: input.conditionKind,
        enabled: input.enabled,
        predicateKey: input.predicateKey,
        revision,
        updatedAt: now,
        updatedByUserId: input.actorUserId,
      })
      .where(eq(organizationGroupRules.groupId, rule.groupId))
  }
  await transaction.insert(organizationGroupRuleRevisions).values({
    bundleIds,
    changedByUserId: input.actorUserId,
    conditionKind: input.conditionKind,
    deploymentId: 1,
    enabled: input.enabled,
    groupId: rule.groupId,
    organizationVersion: organization.organizationVersion,
    predicateKey: input.predicateKey,
    revision,
  })
  await transaction
    .insert(organizationGroupRuleReconciliation)
    .values({
      completedAt: null,
      cursorUserId: null,
      deploymentId: 1,
      groupId: rule.groupId,
      organizationVersion: organization.organizationVersion,
      revision,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: organizationGroupRuleReconciliation.groupId,
      set: { completedAt: null, cursorUserId: null, revision, updatedAt: now },
    })
  const permissions = await loadConfiguredRulePermissions(
    transaction,
    organization.organizationVersion,
    bundleIds,
  )
  await appendOrganizationRuleAuditEvent(
    transaction,
    {
      actorId: input.actorUserId,
      actorType: 'user',
      eventType: input.eventType,
      groupId: rule.groupId,
      occurredAt: now,
      organizationVersion: organization.organizationVersion,
      outcome: 'transitioned',
      policyVersion: organization.policyVersion,
      reason: input.reason,
      resultingPermissions: [],
      ruleRevision: revision,
      subjectId: rule.groupId,
      subjectType: 'group',
    },
    [],
    permissions,
  )
  await appendDomainEvent(transaction, {
    aggregateId: '1',
    occurredAt: now,
    payload: {
      groupId: rule.groupId,
      organizationVersion: organization.organizationVersion,
      revision,
    },
    payloadVersion: 1,
    type: 'organization.group-rule-changed',
  })
  return revision
}

export const reviseRulesForPermissionBundleInTransaction = async (
  transaction: DatabaseTransaction,
  organization: Organization,
  bundleId: string,
  actorUserId: string,
  reason: string,
) => {
  const memberships = await transaction
    .select({ groupId: organizationGroupPermissionBundles.groupId })
    .from(organizationGroupPermissionBundles)
    .where(
      and(
        eq(organizationGroupPermissionBundles.bundleId, bundleId),
        eq(
          organizationGroupPermissionBundles.organizationVersion,
          organization.organizationVersion,
        ),
        eq(organizationGroupPermissionBundles.deploymentId, 1),
      ),
    )
  if (memberships.length === 0) {
    return
  }
  const rules = await transaction
    .select()
    .from(organizationGroupRules)
    .where(
      and(
        eq(organizationGroupRules.organizationVersion, organization.organizationVersion),
        inArray(
          organizationGroupRules.groupId,
          memberships.map(({ groupId }) => groupId),
        ),
      ),
    )
    .orderBy(asc(organizationGroupRules.groupId))
    .for('update')
  /* oxlint-disable no-await-in-loop -- Rule revisions lock in stable group order. */
  for (const rule of rules) {
    await reviseOrganizationRuleInTransaction(transaction, organization, rule, {
      actorUserId,
      conditionKind: rule.conditionKind,
      enabled: rule.enabled,
      eventType: 'group-rule.updated',
      predicateKey: rule.predicateKey,
      reason,
    })
  }
  /* oxlint-enable no-await-in-loop */
}
