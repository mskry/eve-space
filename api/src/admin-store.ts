import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { deploymentSetupLockId } from './db/locks.js'
import {
  adminSessions,
  deploymentAdmins,
  deploymentSettings,
  type DeploymentOrganizationType,
} from './db/schema.js'
import { hashToken } from './security.js'

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

    await transaction.insert(deploymentSettings).values({
      id: 1,
      ownerAdminId: admin.id,
      organizationType: input.organization.type,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      organizationTicker: input.organization.ticker,
    })
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
) {
  await db
    .update(deploymentSettings)
    .set({
      organizationType: organization.type,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationTicker: organization.ticker,
      updatedAt: new Date(),
    })
    .where(eq(deploymentSettings.id, 1))
  return organization
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
