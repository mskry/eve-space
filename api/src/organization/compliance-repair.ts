import { and, asc, eq, isNotNull, lte, notExists, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSettings, organizationAccountCompliance, users } from '../db/schema.js'
import { recomputeOrganizationAccountCompliance } from './compliance.js'
import { expireOrganizationCharacterExceptions } from './exception-store.js'

const defaultRepairBatchSize = 100

export async function repairOrganizationCompliance(
  options: {
    now?: Date
    limit?: number
    signal?: AbortSignal
  } = {},
) {
  const now = options.now ?? new Date()
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? defaultRepairBatchSize)))
  options.signal?.throwIfAborted()
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) return { repaired: 0 }
  await expireOrganizationCharacterExceptions(now, limit)
  options.signal?.throwIfAborted()

  const missing = await db
    .select({ userId: users.id })
    .from(users)
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(organizationAccountCompliance)
          .where(
            and(
              eq(organizationAccountCompliance.deploymentId, 1),
              eq(
                organizationAccountCompliance.organizationVersion,
                organization.organizationVersion,
              ),
              eq(organizationAccountCompliance.userId, users.id),
            ),
          ),
      ),
    )
    .orderBy(asc(users.id))
    .limit(limit)
  let remaining = limit - missing.length
  const due =
    remaining > 0
      ? await db
          .select({ userId: organizationAccountCompliance.userId })
          .from(organizationAccountCompliance)
          .where(
            and(
              eq(organizationAccountCompliance.deploymentId, 1),
              eq(
                organizationAccountCompliance.organizationVersion,
                organization.organizationVersion,
              ),
              eq(organizationAccountCompliance.authoritative, true),
              or(
                and(
                  eq(organizationAccountCompliance.state, 'compliant'),
                  lte(organizationAccountCompliance.accessValidUntil, now),
                ),
                and(
                  eq(organizationAccountCompliance.state, 'review_required'),
                  or(
                    and(
                      isNotNull(organizationAccountCompliance.accessValidUntil),
                      lte(organizationAccountCompliance.accessValidUntil, now),
                    ),
                    lte(organizationAccountCompliance.reviewDeadline, now),
                  ),
                ),
              ),
            ),
          )
          .orderBy(
            asc(organizationAccountCompliance.accessValidUntil),
            asc(organizationAccountCompliance.userId),
          )
          .limit(remaining)
      : []
  remaining -= due.length
  const oldest =
    remaining > 0
      ? await db
          .select({ userId: organizationAccountCompliance.userId })
          .from(organizationAccountCompliance)
          .where(
            and(
              eq(organizationAccountCompliance.deploymentId, 1),
              eq(
                organizationAccountCompliance.organizationVersion,
                organization.organizationVersion,
              ),
            ),
          )
          .orderBy(
            asc(organizationAccountCompliance.evaluatedAt),
            asc(organizationAccountCompliance.userId),
          )
          .limit(remaining)
      : []
  const userIds = [...new Set([...missing, ...due, ...oldest].map(({ userId }) => userId))]
  const failures: unknown[] = []
  let repaired = 0
  for (const userId of userIds) {
    options.signal?.throwIfAborted()
    try {
      // oxlint-disable-next-line no-await-in-loop -- Continue after isolated account failures.
      await recomputeOrganizationAccountCompliance({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId,
        now,
      })
      repaired += 1
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `Failed to repair ${failures.length} compliance projection(s)`,
    )
  return { repaired }
}
