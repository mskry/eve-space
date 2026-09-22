import { eq } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { deploymentSettings } from '../db/schema.js'
import type { AuthorityOperation } from './authority-policy.js'
import { loadEffectiveOrganizationAuthority } from './effective-authority.js'

type Database = DatabaseTransaction | typeof db

export type OrganizationManagementAuthority = 'director' | 'organization_owner'

export async function hasCurrentOrganizationManagerAuthority(
  userId: string,
  operation: AuthorityOperation = 'read-continuity',
) {
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) return false
  return Boolean(
    await loadManagementAuthority(
      db,
      organization.organizationVersion,
      userId,
      new Date(),
      operation,
    ),
  )
}

export async function loadManagementAuthority(
  database: Database,
  organizationVersion: number,
  userId: string,
  now = new Date(),
  operation: AuthorityOperation = 'read-continuity',
): Promise<OrganizationManagementAuthority | null> {
  const authority = await loadEffectiveOrganizationAuthority(
    database,
    organizationVersion,
    userId,
    operation,
    now,
  )
  if (authority.organizationOwner) return 'organization_owner'
  if (authority.director) return 'director'
  return null
}
