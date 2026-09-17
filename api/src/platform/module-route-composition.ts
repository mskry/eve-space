import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOrganizationContributionAuthorization,
  PlatformOrganizationCommandId,
  PlatformOwnedCharacterRouteEnv,
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetRouteEnv,
  PlatformRouteSecurityClassification,
} from '@eve-space/platform-module-contract/server'
import { Hono, type MiddlewareHandler, type Schema } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession, requireSession } from '../middleware/auth-session.js'
import {
  exposeAuthenticatedSessionModuleContext,
  exposeOwnedCharacterModuleContext,
  exposeReviewerSearchModuleContext,
  exposeReviewerTargetModuleContext,
  requireModuleOrganizationAuthorization,
  requireModuleReviewerAuthorization,
} from '../middleware/module-authorization.js'
import { requireInstalledModuleEnabled } from '../middleware/module-enablement.js'
import { loadOrganizationSession } from '../middleware/organization-session.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import {
  loadOrganizationReviewerTarget,
  reviewerAccountParams,
  reviewerCharacterParams,
} from '../middleware/reviewer-target.js'

function composeAuthenticatedSessionModuleRoute<
  RouteSchema extends Schema,
  RouteBasePath extends string,
>(
  moduleId: string,
  organization: PlatformOrganizationContributionAuthorization & PlatformRouteSecurityClassification,
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
  organization: PlatformOrganizationContributionAuthorization & PlatformRouteSecurityClassification,
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
    .use('*', exposeReviewerSearchModuleContext())
    .route('/', route)
}

type ReviewerRouteCommandIds<Organization> = Organization extends {
  readonly organizationCommands: infer CommandIds extends readonly PlatformOrganizationCommandId[]
}
  ? CommandIds
  : readonly []

function composeReviewerTargetModuleRoute<
  const Organization extends PlatformOrganizationContributionAuthorization &
    PlatformRouteSecurityClassification,
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
) {
  const reviewerTargetKind = resolveReviewerTargetKind(organization.target)
  if (!reviewerTargetKind) throw new Error('Reviewer target route requires an account target')
  return new Hono()
    .use('*', privateNoStore)
    .use('*', requireInstalledModuleEnabled(moduleId, organization.sectionId))
    .use('*', loadSession)
    .use('*', requireSession)
    .use('*', loadOrganizationSession)
    .use('*', requireModuleReviewerAuthorization(organization))
    .use('*', reviewerTargetParamsValidator(reviewerTargetKind))
    .use('*', loadOrganizationReviewerTarget(reviewerTargetKind))
    .use(
      '*',
      exposeReviewerTargetModuleContext(
        moduleId,
        organization.sectionId,
        (organization.organizationCommands ?? []) as ReviewerRouteCommandIds<Organization>,
      ),
    )
    .route('/', route)
}

function composeOwnedCharacterModuleRoute<RouteSchema extends Schema, RouteBasePath extends string>(
  moduleId: string,
  organization: PlatformOrganizationContributionAuthorization & PlatformRouteSecurityClassification,
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
