import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSettings } from '../db/schema.js'

export async function loadCurrentOrganizationIdentity() {
  const [organization] = await db
    .select({
      deploymentId: deploymentSettings.id,
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationVersion: deploymentSettings.organizationVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) throw new Error('Deployment organization is not configured')
  return organization
}
