import { eq } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { deploymentSettings } from '../db/schema.js'

export async function lockCurrentOrganization(
  transaction: DatabaseTransaction,
  strength: 'update' | 'key share' = 'update',
) {
  const [organization] = await transaction
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
      policyVersion: deploymentSettings.registrationPolicyVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
    .for(strength)
  if (!organization) {
    throw new Error('Deployment organization is not configured')
  }
  return organization
}
