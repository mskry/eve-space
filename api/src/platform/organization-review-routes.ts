import type { PlatformInstalledReviewerContributionDescriptor } from '@eve-space/platform-module-contract/installed'
import {
  platformReviewerDirectoryAuditStates,
  platformReviewerDirectoryComplianceStates,
  platformReviewerDirectorySortDirections,
  platformReviewerDirectorySortFields,
} from '@eve-space/platform-module-contract/reviewer-directory'
import {
  isPlatformReviewerAccountSearchCursor,
  isPlatformReviewerAccountSearchQuery,
} from '@eve-space/platform-module-contract/server'
import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { routeNotFoundBody } from '../http/contracts.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession, requireSession } from '../middleware/auth-session.js'
import {
  loadOrganizationSession,
  type OrganizationSessionEnv,
} from '../middleware/organization-session.js'
import {
  authorizeOrganizationReviewerContribution,
  type OrganizationContributionAuthorizationResult,
} from '../organization/module-authorization.js'
import {
  ReviewerAccountSearchInputError,
  searchManagedOrganizationDirectory,
} from '../organization/reviewer-account-search.js'
import { resolveOrganizationReviewerTarget } from '../organization/reviewer-target.js'
import { listAvailableReviewerContributions } from './reviewer-contributions.js'

const reviewerDirectorySummaryPermission = 'member-audit.summary.read'
const reviewerDirectoryQuery = z.object({
  query: z.string().trim().refine(isPlatformReviewerAccountSearchQuery).optional(),
  corporationId: z.coerce.number().int().positive().optional(),
  groupId: z.uuid().optional(),
  complianceState: z.enum(platformReviewerDirectoryComplianceStates).optional(),
  blocked: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  auditState: z.enum(platformReviewerDirectoryAuditStates).optional(),
  sort: z.enum(platformReviewerDirectorySortFields).optional(),
  direction: z.enum(platformReviewerDirectorySortDirections).optional(),
  cursor: z.string().refine(isPlatformReviewerAccountSearchCursor).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
})
const reviewerTargetParams = z.object({ userId: z.uuid() })

type OrganizationReviewerEntryEnv = {
  Variables: OrganizationSessionEnv['Variables'] & {
    availableReviewerContributions: readonly PlatformInstalledReviewerContributionDescriptor[]
  }
}

export const organizationReviewerPlatformRoutes = new Hono<OrganizationReviewerEntryEnv>()
  .use('*', privateNoStore, loadSession, requireSession, loadOrganizationSession)
  .use('*', createOrganizationReviewerEntryGate())
  .get('/', (context) =>
    context.json({
      organizationVersion: context.var.organization!.organizationVersion,
      contributions: context.var.availableReviewerContributions.map(projectContribution),
    }),
  )
  .get('/members', zValidator('query', reviewerDirectoryQuery), async (context) => {
    try {
      return context.json(
        await searchManagedOrganizationDirectory({
          organizationVersion: context.var.organization!.organizationVersion,
          filters: context.req.valid('query'),
        }),
      )
    } catch (error) {
      if (!(error instanceof ReviewerAccountSearchInputError)) throw error
      return context.json(
        {
          code: 'INVALID_REVIEWER_DIRECTORY_INPUT',
          message: 'Invalid reviewer directory input.',
        },
        400,
      )
    }
  })
  .get('/members/:userId', zValidator('param', reviewerTargetParams), async (context) => {
    const target = await resolveOrganizationReviewerTarget({
      organizationVersion: context.var.organization!.organizationVersion,
      targetUserId: context.req.valid('param').userId,
    })
    if (!target) return context.json(routeNotFoundBody, 404)
    const managedAffiliation = target.characters.find(
      ({ affiliation }) =>
        affiliation.membership === 'managed' && affiliation.freshness === 'fresh',
    )!
    return context.json({
      organizationVersion: target.organizationVersion,
      member: {
        managedMemberLifecycleId: target.managedMemberLifecycleId,
        account: target.account,
        managedAffiliation: {
          characterId: managedAffiliation.characterId,
          name: managedAffiliation.name,
          corporationId: managedAffiliation.affiliation.corporationId,
          allianceId: managedAffiliation.affiliation.allianceId,
          checkedAt: managedAffiliation.affiliation.checkedAt,
        },
        characters: target.characters,
      },
    })
  })

function createOrganizationReviewerEntryGate() {
  return createMiddleware<OrganizationReviewerEntryEnv>(async (context, next) => {
    const available = await listAvailableReviewerContributions()
    if (available.length === 0) return context.json(routeNotFoundBody, 404)

    const session = context.var.session
    const organization = context.var.organization
    if (!session || !organization) throw new Error('Organization reviewer session is unavailable')
    const authorizations = await Promise.all(
      available.map((contribution) =>
        authorizeOrganizationReviewerContribution(
          session.userId,
          organization,
          contribution.directoryPermission
            ? {
                ...contribution,
                additionalRequiredPermissions: [
                  contribution.directoryPermission,
                  reviewerDirectorySummaryPermission,
                ],
              }
            : contribution,
        ),
      ),
    )
    const authorized = available.filter((_, index) => authorizations[index]!.authorized)
    if (authorized.length === 0) return reviewerEntryDenied(context, organization, authorizations)

    context.set('availableReviewerContributions', authorized)
    await next()
  })
}

function reviewerEntryDenied(
  context: Context<OrganizationReviewerEntryEnv>,
  organization: NonNullable<OrganizationSessionEnv['Variables']['organization']>,
  authorizations: readonly OrganizationContributionAuthorizationResult[],
) {
  if (
    authorizations.some(
      (authorization) => !authorization.authorized && authorization.reason === 'blocked',
    )
  )
    return context.json(
      {
        code: 'ORGANIZATION_MEMBER_BLOCKED',
        message: 'Organization access is blocked.',
        state: organization.state,
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
      },
      403,
    )
  if (
    authorizations.some(
      (authorization) => !authorization.authorized && authorization.reason === 'compliance',
    )
  )
    return context.json(
      {
        code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
        message: 'Current organization compliance is required.',
        state: organization.state,
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
      },
      403,
    )
  return context.json(
    {
      code: 'ORGANIZATION_REVIEWER_REQUIRED',
      message: 'Organization reviewer authority and contribution permission are required.',
    },
    403,
  )
}

function projectContribution(contribution: PlatformInstalledReviewerContributionDescriptor) {
  return {
    moduleId: contribution.moduleId,
    contributionId: contribution.contributionId,
    routeId: contribution.routeId,
    routePath: contribution.routePath,
    sectionId: contribution.sectionId,
    target: contribution.target,
    label: contribution.label,
    description: contribution.description,
    icon: contribution.icon,
    order: contribution.order,
  }
}
