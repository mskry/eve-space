import { Hono } from 'hono'
import type { OrganizationSessionEnv } from '../middleware/organization-session.js'
import { resolveOrganizationEntitlementScope } from './access-policy.js'
import { aggregateOrganizationActivities } from './activity.js'
import { getOrganizationAccountComplianceDetails } from './compliance-details.js'
import { getOrganizationAccessContext } from './role-store.js'
import { requireOrganizationActivityAccess } from './route-middleware.js'

export const organizationMemberRoutes = new Hono<OrganizationSessionEnv>()
  .get('/context', async (context) => {
    const access = await getOrganizationAccessContext(context.var.session!.userId)
    const organization = context.var.organization
    return context.json({
      ...access,
      memberAccess:
        !organization?.blocked &&
        organization?.organizationVersion === access.organization.organizationVersion &&
        resolveOrganizationEntitlementScope(organization) !== 'none',
    })
  })
  .get('/compliance', async (context) =>
    context.json(await getOrganizationAccountComplianceDetails(context.var.session!.userId)),
  )
  .get('/activities', requireOrganizationActivityAccess, async (context) =>
    context.json(
      await aggregateOrganizationActivities(context.var.session!.userId, context.var.organization!),
    ),
  )
