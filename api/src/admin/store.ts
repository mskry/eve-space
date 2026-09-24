import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSetupLockId } from '../db/locks.js'
import {
  adminSessions,
  deploymentAdmins,
  deploymentInstallationSettings,
  deploymentSettings,
  organizationAccountCompliance,
  organizationEpochs,
  organizationManagedCorporations,
  organizationRoleGrants,
  type DeploymentOrganizationType,
} from '../db/schema.js'
import { hashToken } from '../auth/security.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { appendOrganizationAuditEvent } from '../organization/audit.js'
import { invalidateOrganizationAuthoritySourcesInTransaction } from '../organization/authority-convergence.js'
import { recomputeAllOrganizationAccountsInTransaction } from '../organization/compliance.js'
import { endManagedMemberLifecyclesForOrganizationVersionInTransaction } from '../organization/managed-member-lifecycle.js'
import { initializeManagedOrganization } from '../organization/managed-corporations.js'

export interface DeploymentSettingsRecord {
  organization: {
    type: DeploymentOrganizationType
    id: number
    name: string
    ticker: string
  }
}

export interface AdminSessionAccount {
  adminId: string
  email: string
  role: 'owner'
  organization: DeploymentSettingsRecord['organization'] | null
}

export class DeploymentAlreadyConfiguredError extends Error {}

interface SettingsColumns {
  organizationType: DeploymentOrganizationType | null
  organizationId: number | null
  organizationName: string | null
  organizationTicker: string | null
}

const settingsSelection = {
  organizationId: deploymentSettings.organizationId,
  organizationName: deploymentSettings.organizationName,
  organizationTicker: deploymentSettings.organizationTicker,
  organizationType: deploymentSettings.organizationType,
}

export async function isDeploymentConfigured() {
  const [record] = await db
    .select({ ownerAdminId: deploymentInstallationSettings.ownerAdminId })
    .from(deploymentInstallationSettings)
    .where(eq(deploymentInstallationSettings.id, 1))
  return Boolean(record?.ownerAdminId)
}

export async function createDeployment(input: {
  email: string
  passwordHash: string
  sessionToken: string
  sessionExpiresAt: Date
  organization: DeploymentSettingsRecord['organization']
}): Promise<AdminSessionAccount> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${deploymentSetupLockId})`)
    const [installation] = await transaction
      .select({ ownerAdminId: deploymentInstallationSettings.ownerAdminId })
      .from(deploymentInstallationSettings)
      .where(eq(deploymentInstallationSettings.id, 1))
      .for('update')
    if (!installation) {
      throw new Error('Deployment installation settings are missing')
    }
    if (installation.ownerAdminId) {
      throw new DeploymentAlreadyConfiguredError()
    }

    const [admin] = await transaction
      .insert(deploymentAdmins)
      .values({ email: input.email, passwordHash: input.passwordHash })
      .returning({ email: deploymentAdmins.email, id: deploymentAdmins.id })
    if (!admin) {
      throw new Error('Failed to create deployment owner')
    }

    await transaction
      .update(deploymentInstallationSettings)
      .set({ ownerAdminId: admin.id, updatedAt: new Date() })
      .where(eq(deploymentInstallationSettings.id, 1))

    await transaction.insert(organizationEpochs).values({
      deploymentId: 1,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      organizationTicker: input.organization.ticker,
      organizationType: input.organization.type,
      organizationVersion: 1,
    })
    await transaction.insert(deploymentSettings).values({
      id: 1,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      organizationTicker: input.organization.ticker,
      organizationType: input.organization.type,
    })
    await initializeManagedOrganization(
      transaction,
      {
        deploymentId: 1,
        organizationId: input.organization.id,
        organizationType: input.organization.type,
        organizationVersion: 1,
      },
      new Date(),
    )
    await transaction.insert(adminSessions).values({
      adminId: admin.id,
      expiresAt: input.sessionExpiresAt,
      sessionHash: hashToken(input.sessionToken),
    })

    return toAccount(admin, input.organization)
  })
}

export async function findAdminCredentials(email: string) {
  const [record] = await db
    .select({
      email: deploymentAdmins.email,
      id: deploymentAdmins.id,
      passwordHash: deploymentAdmins.passwordHash,
    })
    .from(deploymentAdmins)
    .innerJoin(
      deploymentInstallationSettings,
      eq(deploymentInstallationSettings.ownerAdminId, deploymentAdmins.id),
    )
    .where(eq(deploymentAdmins.email, email))
  return record ?? null
}

export async function createAdminSession(adminId: string, sessionToken: string, expiresAt: Date) {
  await db.insert(adminSessions).values({
    adminId,
    expiresAt,
    sessionHash: hashToken(sessionToken),
  })
}

export async function findAdminSession(sessionToken: string): Promise<AdminSessionAccount | null> {
  const [record] = await db
    .select({
      adminId: deploymentAdmins.id,
      email: deploymentAdmins.email,
      ...settingsSelection,
    })
    .from(adminSessions)
    .innerJoin(deploymentAdmins, eq(deploymentAdmins.id, adminSessions.adminId))
    .innerJoin(
      deploymentInstallationSettings,
      eq(deploymentInstallationSettings.ownerAdminId, deploymentAdmins.id),
    )
    .leftJoin(deploymentSettings, eq(deploymentSettings.id, deploymentInstallationSettings.id))
    .where(
      and(
        eq(adminSessions.sessionHash, hashToken(sessionToken)),
        gt(adminSessions.expiresAt, new Date()),
      ),
    )
  return record ? toAccount(record, toOrganization(record)) : null
}

export async function deleteAdminSession(sessionToken: string) {
  await db.delete(adminSessions).where(eq(adminSessions.sessionHash, hashToken(sessionToken)))
}

export async function updateDeploymentOrganization(
  organization: DeploymentSettingsRecord['organization'],
  actorAdminId: string,
) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (!current) {
      throw new Error('Deployment settings are missing')
    }

    const now = new Date()
    const identityChanged =
      current.organizationType !== organization.type || current.organizationId !== organization.id
    if (!identityChanged) {
      await transaction
        .update(deploymentSettings)
        .set({
          organizationName: organization.name,
          organizationTicker: organization.ticker,
          updatedAt: now,
        })
        .where(eq(deploymentSettings.id, 1))
      return organization
    }

    const organizationVersion = current.organizationVersion + 1
    await endManagedMemberLifecyclesForOrganizationVersionInTransaction(transaction, {
      deploymentId: 1,
      now,
      organizationVersion: current.organizationVersion,
    })
    await transaction.insert(organizationEpochs).values({
      createdAt: now,
      deploymentId: current.id,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationTicker: organization.ticker,
      organizationType: organization.type,
      organizationVersion,
    })
    await transaction
      .update(organizationEpochs)
      .set({ supersededAt: sql`greatest(clock_timestamp(), ${organizationEpochs.createdAt})` })
      .where(
        and(
          eq(organizationEpochs.deploymentId, current.id),
          eq(organizationEpochs.organizationVersion, current.organizationVersion),
        ),
      )
    await transaction
      .update(organizationRoleGrants)
      .set({
        revocationReason: 'Managed organization changed.',
        revokedAt: now,
        revokedByUserId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, current.id),
          eq(organizationRoleGrants.organizationVersion, current.organizationVersion),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
    await invalidateOrganizationAuthoritySourcesInTransaction(transaction, {
      now,
      organizationVersion: current.organizationVersion,
      policyVersion: current.registrationPolicyVersion,
    })
    await transaction
      .update(organizationAccountCompliance)
      .set({ authoritative: false, invalidatedAt: now, updatedAt: now })
      .where(
        and(
          eq(organizationAccountCompliance.deploymentId, current.id),
          eq(organizationAccountCompliance.organizationVersion, current.organizationVersion),
          eq(organizationAccountCompliance.authoritative, true),
        ),
      )
    await transaction
      .update(organizationManagedCorporations)
      .set({
        isCurrent: false,
        removedAt: sql`greatest(
          clock_timestamp(),
          ${organizationManagedCorporations.firstObservedAt},
          ${organizationManagedCorporations.lastObservedAt}
        )`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(organizationManagedCorporations.deploymentId, current.id),
          eq(organizationManagedCorporations.organizationVersion, current.organizationVersion),
          eq(organizationManagedCorporations.isCurrent, true),
        ),
      )
    await transaction
      .update(deploymentSettings)
      .set({
        organizationId: organization.id,
        organizationName: organization.name,
        organizationTicker: organization.ticker,
        organizationType: organization.type,
        organizationVersion,
        updatedAt: now,
      })
      .where(eq(deploymentSettings.id, current.id))

    await initializeManagedOrganization(
      transaction,
      {
        deploymentId: current.id,
        organizationId: organization.id,
        organizationType: organization.type,
        organizationVersion,
      },
      now,
    )

    await appendOrganizationAuditEvent(transaction, {
      actorId: actorAdminId,
      actorType: 'deployment_admin',
      deploymentId: 1,
      eventType: 'organization.changed',
      occurredAt: now,
      organizationVersion,
      outcome: 'transitioned',
      policyVersion: current.registrationPolicyVersion,
      reason: 'The deployment administrator changed the managed organization.',
      subjectId: String(current.id),
      subjectType: 'deployment',
    })
    await appendDomainEvent(transaction, {
      aggregateId: String(current.id),
      occurredAt: now,
      payload: {
        actorAdminId,
        organizationId: organization.id,
        organizationType: organization.type,
        organizationVersion,
        previousOrganizationId: current.organizationId,
        previousOrganizationType: current.organizationType,
        previousOrganizationVersion: current.organizationVersion,
      },
      payloadVersion: 1,
      type: 'organization.changed',
    })
    await recomputeAllOrganizationAccountsInTransaction(transaction, {
      deploymentId: 1,
      now,
      organizationVersion,
    })
    return organization
  })
}

function toOrganization(record: SettingsColumns): DeploymentSettingsRecord['organization'] | null {
  if (
    !record.organizationType ||
    record.organizationId === null ||
    !record.organizationName ||
    !record.organizationTicker
  ) {
    return null
  }
  return {
    id: record.organizationId,
    name: record.organizationName,
    ticker: record.organizationTicker,
    type: record.organizationType,
  }
}

function toAccount(
  admin: { id?: string; adminId?: string; email: string },
  organization: DeploymentSettingsRecord['organization'] | null,
): AdminSessionAccount {
  return {
    adminId: admin.id ?? admin.adminId!,
    email: admin.email,
    organization,
    role: 'owner',
  }
}
