import { db } from '../db/client.js'
import { expireCurrentOrganizationGroupAssignments } from './group-assignment-expiry.js'
import { getOrganizationGroupPermissionsFromDatabase } from './group-permission-reader.js'

export const getOrganizationGroupPermissions = async (
  userId: string,
  now = new Date(),
  organizationVersion?: number,
) => {
  await expireCurrentOrganizationGroupAssignments(now)
  const { modules, services } = await getOrganizationGroupPermissionsFromDatabase(
    db,
    userId,
    now,
    organizationVersion,
  )
  return { modules, services }
}
