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
  auditState: z.enum(platformReviewerDirectoryAuditStates).optional(),
  blocked: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  complianceState: z.enum(platformReviewerDirectoryComplianceStates).optional(),
  corporationId: z.coerce.number().int().positive().optional(),
  cursor: z.string().refine(isPlatformReviewerAccountSearchCursor).optional(),
  direction: z.enum(platformReviewerDirectorySortDirections).optional(),
  groupId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  query: z.string().trim().refine(isPlatformReviewerAccountSearchQuery).optional(),
  sort: z.enum(platformReviewerDirectorySortFields).optional(),
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
      contributions: context.var.availableReviewerContributions.map(projectContribution),
      organizationVersion: context.var.organization!.organizationVersion,
    }),
  )
  .get('/members', zValidator('query', reviewerDirectoryQuery), async (context) => {
    try {
      return context.json(
        await searchManagedOrganizationDirectory({
          filters: context.req.valid('query'),
          organizationVersion: context.var.organization!.organizationVersion,
        }),
      )
    } catch (error) {
      if (!(error instanceof ReviewerAccountSearchInputError)) {
        throw error
      }
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
    if (!target) {
      return context.json(routeNotFoundBody, 404)
    }
    const managedAffiliation = target.characters.find(
      ({ affiliation }) =>
        affiliation.membership === 'managed' && affiliation.freshness === 'fresh',
    )!
    return context.json({
      member: {
        account: target.account,
        characters: target.characters,
        managedAffiliation: {
          allianceId: managedAffiliation.affiliation.allianceId,
          characterId: managedAffiliation.characterId,
          checkedAt: managedAffiliation.affiliation.checkedAt,
          corporationId: managedAffiliation.affiliation.corporationId,
          name: managedAffiliation.name,
        },
        managedMemberLifecycleId: target.managedMemberLifecycleId,
      },
      organizationVersion: target.organizationVersion,
    })
  })

function createOrganizationReviewerEntryGate() {
  return createMiddleware<OrganizationReviewerEntryEnv>(async (context, next) => {
    const available = await listAvailableReviewerContributions()
    if (available.length === 0) {
      return context.json(routeNotFoundBody, 404)
    }

    const session = context.var.session
    const organization = context.var.organization
    if (!session || !organization) {
      throw new Error('Organization reviewer session is unavailable')
    }
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
    if (authorized.length === 0) {
      return reviewerEntryDenied(context, organization, authorizations)
    }

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
  ) {
    return context.json(
      {
        code: 'ORGANIZATION_MEMBER_BLOCKED',
        message: 'Organization access is blocked.',
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
        state: organization.state,
      },
      403,
    )
  }
  if (
    authorizations.some(
      (authorization) => !authorization.authorized && authorization.reason === 'compliance',
    )
  ) {
    return context.json(
      {
        code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
        message: 'Current organization compliance is required.',
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
        state: organization.state,
      },
      403,
    )
  }
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
    contributionId: contribution.contributionId,
    description: contribution.description,
    icon: contribution.icon,
    label: contribution.label,
    moduleId: contribution.moduleId,
    order: contribution.order,
    routeId: contribution.routeId,
    routePath: contribution.routePath,
    sectionId: contribution.sectionId,
    target: contribution.target,
  }
}
