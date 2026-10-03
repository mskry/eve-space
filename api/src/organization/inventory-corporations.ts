import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { hasCurrentReviewerOrganizationSnapshot } from './reviewer-organization-snapshot.js'

export const listInventoryCorporations = (organizationVersion: number) =>
  db.transaction(
    async (transaction) => {
      await transaction.execute(sql`set local statement_timeout = '5s'`)
      if (
        !(await hasCurrentReviewerOrganizationSnapshot(
          transaction,
          organizationVersion,
          new Date(),
        ))
      )
        return null
      const rows = await transaction.execute<{ corporationId: number }>(sql`
      select corporation_id::float8 as "corporationId" from organization_managed_corporations
      where deployment_id = 1 and organization_version = ${organizationVersion} and is_current
      order by corporation_id limit 251
    `)
      if (rows.length > 250) return null
      return rows.map((row) => row.corporationId)
    },
    { isolationLevel: 'repeatable read' },
  )
