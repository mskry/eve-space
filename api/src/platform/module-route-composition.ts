import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOrganizationCommandId,
  PlatformOwnedCharacterRouteEnv,
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetRouteEnv,
  PlatformRouteSecurityClassification,
} from '@eve-space/platform-module-contract/server'
import { resolvePlatformModuleRoutePath } from '@eve-space/platform-module-contract/server'
import type {
  PlatformInstalledOrganizationContributionAuthorization,
  PlatformInstalledReviewerContributionDescriptor,
} from '@eve-space/platform-module-contract/installed'
import { PlatformModuleHttpError } from '@eve-space/platform-module-server'
import { Hono, type Context, type MiddlewareHandler, type Schema } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import {
  organizationSensitiveAccessSections,
  type OrganizationSensitiveAccessReason,
} from '../db/schema.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { recordDiagnostic } from '../logging.js'
import { loadSession, requireSession } from '../middleware/auth-session.js'
import {
  exposeAuthenticatedSessionModuleContext,
  exposeOwnedCharacterModuleContext,
  exposeReviewerSearchModuleContext,
  exposeReviewerTargetModuleContext,
  requireModuleOrganizationAuthorization,
  requireModuleReviewerAuthorization,
  type ModuleOrganizationAuthorizationEnv,
} from '../middleware/module-authorization.js'
import { requireInstalledModuleEnabled } from '../middleware/module-enablement.js'
import { loadOrganizationSession } from '../middleware/organization-session.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import {
  loadOrganizationReviewerTarget,
  reviewerAccountParams,
  reviewerCharacterParams,
  type OrganizationReviewerTargetEnv,
} from '../middleware/reviewer-target.js'
import { recordModuleSensitiveAccessDecision } from './module-sensitive-access-audit.js'
import { requireInstalledReviewerContribution } from './reviewer-contributions.js'

function composeAuthenticatedSessionModuleRoute<
  RouteSchema extends Schema,
  RouteBasePath extends string,
>(
  moduleId: string,
  organization: PlatformInstalledOrganizationContributionAuthorization &
    PlatformRouteSecurityClassification,
  route: Hono<PlatformAuthenticatedSessionRouteEnv, RouteSchema, RouteBasePath>,
) {
  if (isManagedOrganizationTarget(organization.target))
    throw new Error('Reviewer target route requires the target-aware composer')
  return new Hono()
    .use('*', privateNoStore)
    .use('*', requireInstalledModuleEnabled(moduleId, organization.sectionId))
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', loadOrganizationSession)
    .use(
      '*',
      isManagedOrganizationTarget(organization.target)
        ? requireModuleReviewerAuthorization(organization)
        : requireModuleOrganizationAuthorization(organization),
    )
    .use('*', exposeAuthenticatedSessionModuleContext(moduleId, organization.sectionId))
    .route('/', route)
}

function composeReviewerSearchModuleRoute<RouteSchema extends Schema, RouteBasePath extends string>(
  moduleId: string,
  organization: PlatformInstalledOrganizationContributionAuthorization &
    PlatformRouteSecurityClassification,
  route: Hono<PlatformReviewerSearchRouteEnv, RouteSchema, RouteBasePath>,
) {
  if (organization.target !== 'managed-organization-account-search')
    throw new Error('Reviewer search route requires the account-search target')
  return new Hono()
    .use('*', privateNoStore)
    .use('*', requireInstalledModuleEnabled(moduleId, organization.sectionId))
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', loadOrganizationSession)
    .use('*', requireModuleReviewerAuthorization(organization))
    .use('*', exposeReviewerSearchModuleContext(moduleId))
    .route('/', route)
}

type ReviewerRouteCommandIds<Organization> = Organization extends {
  readonly organizationCommands: infer CommandIds extends readonly PlatformOrganizationCommandId[]
}
  ? CommandIds
  : readonly []

interface ReviewerEvidenceBinding {
  readonly routeId: string
  readonly resourceId: string
  readonly operationId: string
}

interface ReviewerContributionRouteBinding
  extends
    PlatformInstalledOrganizationContributionAuthorization,
    PlatformRouteSecurityClassification {
  readonly routeId: string
  readonly namespace: string
  readonly target: 'managed-organization-account' | 'managed-organization-character'
  readonly reviewerEvidence?: ReviewerEvidenceBinding
  readonly reviewerResourceIds?: readonly string[]
}

export function composePlatformReviewerContributionRoute<
  const Organization extends ReviewerContributionRouteBinding,
  RouteSchema extends Schema,
  RouteBasePath extends string,
>(
  descriptor: PlatformInstalledReviewerContributionDescriptor,
  organization: Organization,
  route: Hono<
    PlatformReviewerTargetRouteEnv<ReviewerRouteCommandIds<Organization>>,
    RouteSchema,
    RouteBasePath
  >,
  catalog?: readonly PlatformInstalledReviewerContributionDescriptor[],
) {
  const installed = requireInstalledReviewerContribution(descriptor, catalog)
  assertReviewerContributionRouteBinding(installed, organization)
  return composeReviewerTargetModuleRoute(installed.moduleId, organization, route, installed)
}

function composeReviewerTargetModuleRoute<
  const Organization extends PlatformInstalledOrganizationContributionAuthorization &
    PlatformRouteSecurityClassification & {
      readonly reviewerEvidence?: ReviewerEvidenceBinding
      readonly reviewerResourceIds?: readonly string[]
    },
  RouteSchema extends Schema,
  RouteBasePath extends string,
>(
  moduleId: string,
  organization: Organization,
  route: Hono<
    PlatformReviewerTargetRouteEnv<ReviewerRouteCommandIds<Organization>>,
    RouteSchema,
    RouteBasePath
  >,
  contribution?: PlatformInstalledReviewerContributionDescriptor,
) {
  const reviewerTargetKind = resolveReviewerTargetKind(organization.target)
  if (!reviewerTargetKind) throw new Error('Reviewer target route requires an account target')
  const sensitiveAccessAudit = organization.reviewerEvidence
    ? createReviewerEvidenceAccessAudit(moduleId, organization.sectionId)
    : undefined
  const composed = new Hono()
    .use('*', privateNoStore)
    .use('*', requireInstalledModuleEnabled(moduleId, organization.sectionId))
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', loadOrganizationSession)
    .use('*', sensitiveAccessAudit?.denials ?? passThrough)
    .use('*', requireModuleReviewerAuthorization(organization))
    .use('*', reviewerTargetParamsValidator(reviewerTargetKind))
    .use('*', loadOrganizationReviewerTarget(reviewerTargetKind))
    .use('*', sensitiveAccessAudit?.allowed ?? passThrough)
    .use(
      '*',
      exposeReviewerTargetModuleContext(
        organization.publisherPackage,
        moduleId,
        organization.sectionId,
        (organization.organizationCommands ?? []) as ReviewerRouteCommandIds<Organization>,
        organization.reviewerEvidence,
        contribution
          ? {
              contributionId: contribution.contributionId,
              resourceIds:
                organization.reviewerResourceIds ??
                (organization.reviewerEvidence ? [organization.reviewerEvidence.resourceId] : []),
            }
          : undefined,
      ),
    )
    .route('/', route)
  if (!contribution) return composed
  return composed.onError((error, context) =>
    reviewerContributionFailureResponse(error, contribution, context),
  )
}

function assertReviewerContributionRouteBinding(
  contribution: PlatformInstalledReviewerContributionDescriptor,
  route: ReviewerContributionRouteBinding,
) {
  if (
    route.publisherPackage !== contribution.publisherPackage ||
    route.moduleId !== contribution.moduleId ||
    route.routeId !== contribution.routeId ||
    resolvePlatformModuleRoutePath(route.namespace) !== contribution.routePath ||
    route.sectionId !== contribution.sectionId ||
    route.audience !== contribution.audience ||
    route.requiredPermission !== contribution.requiredPermission ||
    route.target !== contribution.target ||
    (route.additionalRequiredPermissions?.length ?? 0) > 0
  )
    throw new Error('Reviewer contribution route binding does not match its installed descriptor')
}

function reviewerContributionFailureResponse(
  error: Error,
  contribution: PlatformInstalledReviewerContributionDescriptor,
  context: Context,
) {
  if (error instanceof PlatformModuleHttpError) return context.json(error.body, error.status)
  if (error instanceof HTTPException) {
    const message = error.message || (error.status === 403 ? 'Forbidden' : 'Request failed.')
    return context.json({ message }, error.status)
  }
  recordDiagnostic('platform.module.error', {
    context: {
      moduleId: contribution.moduleId,
      moduleEvent: `reviewer.${contribution.contributionId}.failed`,
    },
    error,
  })
  return context.json(
    {
      code: 'REVIEWER_CONTRIBUTION_UNAVAILABLE',
      message: 'This reviewer contribution is temporarily unavailable.',
    },
    503,
  )
}

function composeOwnedCharacterModuleRoute<RouteSchema extends Schema, RouteBasePath extends string>(
  moduleId: string,
  organization: PlatformInstalledOrganizationContributionAuthorization &
    PlatformRouteSecurityClassification,
  route: Hono<PlatformOwnedCharacterRouteEnv, RouteSchema, RouteBasePath>,
) {
  return new Hono()
    .use('*', privateNoStore)
    .use('*', requireInstalledModuleEnabled(moduleId, organization.sectionId))
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', loadOrganizationSession)
    .use('*', requireModuleOrganizationAuthorization(organization))
    .use('*', zValidator('param', characterIdParams))
    .use('*', loadOwnedCharacter)
    .use('*', exposeOwnedCharacterModuleContext(moduleId, organization.sectionId))
    .route('/', route)
}

export const platformModuleRouteComposers = {
  'authenticated-session': composeAuthenticatedSessionModuleRoute,
  'managed-organization-account-search': composeReviewerSearchModuleRoute,
  'managed-organization-account': composeReviewerTargetModuleRoute,
  'managed-organization-character': composeReviewerTargetModuleRoute,
  'owned-character': composeOwnedCharacterModuleRoute,
} as const

function isManagedOrganizationTarget(target: PlatformRouteSecurityClassification['target']) {
  return target !== undefined && target !== 'caller'
}

function resolveReviewerTargetKind(
  target: PlatformRouteSecurityClassification['target'],
): 'account' | 'character' | null {
  if (target === 'managed-organization-account') return 'account'
  if (target === 'managed-organization-character') return 'character'
  return null
}

function reviewerTargetParamsValidator(targetKind: 'account' | 'character'): MiddlewareHandler {
  if (targetKind === 'account') return zValidator('param', reviewerAccountParams)
  return zValidator('param', reviewerCharacterParams)
}

const passThrough = createMiddleware(async (_context, next) => next())

function createReviewerEvidenceAccessAudit(moduleId: string, sectionId: string | undefined) {
  if (!isSensitiveAccessSection(sectionId))
    throw new Error('Reviewer evidence route requires an auditable sensitive section')
  return {
    denials: createMiddleware(async (context, next) => {
      await next()
      const target = context.var.organizationReviewerTarget
      if (target) return
      const authorizationDenial = context.var.moduleOrganizationAuthorizationDenialReason
      await recordReviewerEvidenceAccess(context, {
        moduleId,
        sectionId,
        decision: 'denied',
        reason: authorizationDenial
          ? sensitiveAccessDenialReason(authorizationDenial)
          : 'target-not-authorized',
        targetUserId: null,
        targetCharacterId: null,
      })
    }),
    allowed: createMiddleware(async (context, next) => {
      const target = context.var.organizationReviewerTarget
      if (!target) throw new Error('Sensitive access target is unavailable')
      await recordReviewerEvidenceAccess(context, {
        moduleId,
        sectionId,
        decision: 'allowed',
        reason: 'authorized',
        targetUserId: target.account.userId,
        targetCharacterId:
          target.selection.kind === 'character' ? target.selection.characterId : null,
      })
      await next()
    }),
  }
}

async function recordReviewerEvidenceAccess(
  context: Context<{
    Variables: ModuleOrganizationAuthorizationEnv['Variables'] &
      OrganizationReviewerTargetEnv['Variables']
  }>,
  decision: Omit<
    Parameters<typeof recordModuleSensitiveAccessDecision>[0],
    'actorUserId' | 'organizationVersion'
  >,
) {
  const session = context.var.session
  const organization = context.var.organization
  if (!session || !organization) throw new Error('Sensitive access audit context is unavailable')
  await recordModuleSensitiveAccessDecision({
    ...decision,
    actorUserId: session.userId,
    organizationVersion: organization.organizationVersion,
  })
}

function isSensitiveAccessSection(
  sectionId: string | undefined,
): sectionId is (typeof organizationSensitiveAccessSections)[number] {
  return organizationSensitiveAccessSections.includes(sectionId as never)
}

function sensitiveAccessDenialReason(
  reason: 'blocked' | 'compliance' | 'audience' | 'permission',
): OrganizationSensitiveAccessReason {
  if (reason === 'blocked') return 'reviewer-blocked'
  if (reason === 'compliance') return 'reviewer-compliance-required'
  if (reason === 'audience') return 'reviewer-authority-required'
  return 'reviewer-permission-required'
}
