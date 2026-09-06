import { eq } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { deploymentSettings } from '../db/schema.js'

export async function lockCurrentOrganization(
  transaction: DatabaseTransaction,
  strength: 'update' | 'key share' = 'update',
) {
  const [organization] = await transaction
    .select({
      organizationVersion: deploymentSettings.organizationVersion,
      policyVersion: deploymentSettings.registrationPolicyVersion,
      organizationType: deploymentSettings.organizationType,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
    .for(strength)
  if (!organization) throw new Error('Deployment organization is not configured')
  return organization
}
