import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSetupLockId } from '../db/locks.js'
import {
  adminSessions,
  deploymentAdmins,
  deploymentSettings,
  organizationAccountCompliance,
  organizationAuthorityEvidence,
  organizationEpochs,
  organizationManagedCorporations,
  organizationRoleGrants,
  type DeploymentOrganizationType,
} from '../db/schema.js'
import { hashToken } from '../auth/security.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { appendOrganizationAuditEvent } from '../organization/audit.js'
import { initializeManagedOrganization } from '../organization/managed-corporations.js'

export interface DeploymentSettingsRecord {
  organization: {
    type: DeploymentOrganizationType
    id: number
    name: string
    ticker: string
  }
}

export interface AdminSessionAccount extends DeploymentSettingsRecord {
  adminId: string
  email: string
  role: 'owner'
}

export class DeploymentAlreadyConfiguredError extends Error {}

interface SettingsColumns {
  organizationType: DeploymentOrganizationType
  organizationId: number
  organizationName: string
  organizationTicker: string
}

const settingsSelection = {
  organizationType: deploymentSettings.organizationType,
  organizationId: deploymentSettings.organizationId,
  organizationName: deploymentSettings.organizationName,
  organizationTicker: deploymentSettings.organizationTicker,
}

export async function isDeploymentConfigured() {
  const [record] = await db.select({ id: deploymentSettings.id }).from(deploymentSettings).limit(1)
  return Boolean(record)
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
    const [existing] = await transaction
      .select({ id: deploymentSettings.id })
      .from(deploymentSettings)
      .limit(1)
    if (existing) throw new DeploymentAlreadyConfiguredError()

    const [admin] = await transaction
      .insert(deploymentAdmins)
      .values({ email: input.email, passwordHash: input.passwordHash })
      .returning({ id: deploymentAdmins.id, email: deploymentAdmins.email })
    if (!admin) throw new Error('Failed to create deployment owner')

    await transaction.insert(organizationEpochs).values({
      deploymentId: 1,
      organizationVersion: 1,
      organizationType: input.organization.type,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      organizationTicker: input.organization.ticker,
    })
    await transaction.insert(deploymentSettings).values({
      id: 1,
      ownerAdminId: admin.id,
      organizationType: input.organization.type,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      organizationTicker: input.organization.ticker,
    })
    await initializeManagedOrganization(
      transaction,
      {
        deploymentId: 1,
        organizationVersion: 1,
        organizationType: input.organization.type,
        organizationId: input.organization.id,
      },
      new Date(),
    )
    await transaction.insert(adminSessions).values({
      sessionHash: hashToken(input.sessionToken),
      adminId: admin.id,
      expiresAt: input.sessionExpiresAt,
    })

    return toAccount(admin, input.organization)
  })
}

export async function findAdminCredentials(email: string) {
  const [record] = await db
    .select({
      id: deploymentAdmins.id,
      email: deploymentAdmins.email,
      passwordHash: deploymentAdmins.passwordHash,
    })
    .from(deploymentAdmins)
    .where(eq(deploymentAdmins.email, email))
  return record ?? null
}

export async function createAdminSession(adminId: string, sessionToken: string, expiresAt: Date) {
  await db.insert(adminSessions).values({
    sessionHash: hashToken(sessionToken),
    adminId,
    expiresAt,
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
    .innerJoin(deploymentSettings, eq(deploymentSettings.ownerAdminId, deploymentAdmins.id))
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
    if (!current) throw new Error('Deployment settings are missing')

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
    await transaction.insert(organizationEpochs).values({
      deploymentId: current.id,
      organizationVersion,
      organizationType: organization.type,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationTicker: organization.ticker,
      createdAt: now,
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
        revokedAt: now,
        revokedByUserId: null,
        revocationReason: 'Managed organization changed.',
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, current.id),
          eq(organizationRoleGrants.organizationVersion, current.organizationVersion),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
    await transaction
      .update(organizationAuthorityEvidence)
      .set({
        status: 'invalid',
        reviewDeadline: null,
        failureClass: 'strict:organization-changed',
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationAuthorityEvidence.deploymentId, current.id),
          eq(organizationAuthorityEvidence.organizationVersion, current.organizationVersion),
        ),
      )
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
      .set({ isCurrent: false, removedAt: now, updatedAt: now })
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
        organizationType: organization.type,
        organizationId: organization.id,
        organizationName: organization.name,
        organizationTicker: organization.ticker,
        organizationVersion,
        updatedAt: now,
      })
      .where(eq(deploymentSettings.id, current.id))

    await initializeManagedOrganization(
      transaction,
      {
        deploymentId: current.id,
        organizationVersion,
        organizationType: organization.type,
        organizationId: organization.id,
      },
      now,
    )

    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion,
      policyVersion: current.registrationPolicyVersion,
      eventType: 'organization.changed',
      actorType: 'deployment_admin',
      actorId: actorAdminId,
      subjectType: 'deployment',
      subjectId: String(current.id),
      reason: 'The deployment administrator changed the managed organization.',
      outcome: 'transitioned',
      occurredAt: now,
    })
    await appendDomainEvent(transaction, {
      type: 'organization.changed',
      payloadVersion: 1,
      aggregateId: String(current.id),
      payload: {
        actorAdminId,
        previousOrganizationType: current.organizationType,
        previousOrganizationId: current.organizationId,
        previousOrganizationVersion: current.organizationVersion,
        organizationType: organization.type,
        organizationId: organization.id,
        organizationVersion,
      },
      occurredAt: now,
    })
    return organization
  })
}

function toOrganization(record: SettingsColumns) {
  return {
    type: record.organizationType,
    id: record.organizationId,
    name: record.organizationName,
    ticker: record.organizationTicker,
  }
}

function toAccount(
  admin: { id?: string; adminId?: string; email: string },
  organization: DeploymentSettingsRecord['organization'],
): AdminSessionAccount {
  return {
    adminId: admin.id ?? admin.adminId!,
    email: admin.email,
    role: 'owner',
    organization,
  }
}
