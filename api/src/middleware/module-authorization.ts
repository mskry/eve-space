import type {
  PlatformAuthorizedOrganizationContext,
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOrganizationContributionAuthorization,
  PlatformOrganizationCommandId,
  PlatformOwnedCharacterRouteEnv,
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { authRequiredBody } from '../http/contracts.js'
import { createOwnedCharacterCoreReads } from '../platform/core-read-capabilities.js'
import { createPlatformModuleCollectionStatusReads } from '../platform/module-collection-status-capabilities.js'
import { createPlatformReviewerCollectionStatusReads } from '../platform/module-reviewer-collection-status-capabilities.js'
import { createPlatformReviewerEvidenceReads } from '../platform/module-reviewer-evidence-capabilities.js'
import { createPlatformOrganizationCommandCapabilities } from '../platform/module-organization-command-capabilities.js'
import { createPlatformReviewerAccountSearch } from '../platform/reviewer-search-capabilities.js'
import {
  authorizeOrganizationContribution,
  authorizeOrganizationReviewerContribution,
  type OrganizationContributionAuthorizationResult,
} from '../organization/module-authorization.js'
import type { OrganizationSessionEnv } from './organization-session.js'
import type { OwnedCharacterEnv } from './owned-character.js'
import type { OrganizationReviewerTargetEnv } from './reviewer-target.js'

export type ModuleOrganizationAuthorizationEnv = {
  Variables: OrganizationSessionEnv['Variables'] & {
    moduleOrganizationAuthorization: PlatformAuthorizedOrganizationContext | null
    moduleOrganizationAuthorizationDenialReason?: Extract<
      OrganizationContributionAuthorizationResult,
      { authorized: false }
    >['reason']
  }
}

type AuthenticatedSessionModuleEnv = {
  Variables: ModuleOrganizationAuthorizationEnv['Variables'] &
    PlatformAuthenticatedSessionRouteEnv['Variables']
}

type OwnedCharacterModuleEnv = {
  Variables: OwnedCharacterEnv['Variables'] &
    ModuleOrganizationAuthorizationEnv['Variables'] &
    PlatformOwnedCharacterRouteEnv['Variables']
}

type ReviewerTargetModuleEnv<
  CommandIds extends readonly PlatformOrganizationCommandId[] = readonly [],
> = {
  Variables: OrganizationReviewerTargetEnv['Variables'] &
    PlatformReviewerTargetRouteEnv<CommandIds>['Variables']
}

type ReviewerSearchModuleEnv = {
  Variables: ModuleOrganizationAuthorizationEnv['Variables'] &
    PlatformReviewerSearchRouteEnv['Variables']
}

export function requireModuleOrganizationAuthorization(
  declaration: PlatformOrganizationContributionAuthorization,
) {
  return requireOrganizationAuthorization(declaration, false)
}

export function requireModuleReviewerAuthorization(
  declaration: PlatformOrganizationContributionAuthorization,
) {
  return requireOrganizationAuthorization(declaration, true)
}

function requireOrganizationAuthorization(
  declaration: PlatformOrganizationContributionAuthorization,
  reviewer: boolean,
) {
  return createMiddleware<ModuleOrganizationAuthorizationEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)
    const organization = context.var.organization
    if (!organization)
      return context.json(
        {
          code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
          message: 'Current organization compliance is required.',
          state: 'pending',
          reviewDeadline: null,
        },
        403,
      )

    const authorization = reviewer
      ? await authorizeOrganizationReviewerContribution(session.userId, organization, declaration)
      : await authorizeOrganizationContribution(session.userId, organization, declaration)
    if (!authorization.authorized) {
      context.set('moduleOrganizationAuthorizationDenialReason', authorization.reason)
      return organizationAuthorizationDenied(
        context,
        organization,
        declaration,
        authorization,
        reviewer,
      )
    }

    context.set('moduleOrganizationAuthorization', authorization.context)
    await next()
  })
}

function organizationAuthorizationDenied(
  context: Context<ModuleOrganizationAuthorizationEnv>,
  organization: NonNullable<ModuleOrganizationAuthorizationEnv['Variables']['organization']>,
  declaration: PlatformOrganizationContributionAuthorization,
  authorization: Extract<OrganizationContributionAuthorizationResult, { authorized: false }>,
  reviewer: boolean,
) {
  if (authorization.reason === 'blocked')
    return context.json(
      {
        code: 'ORGANIZATION_MEMBER_BLOCKED',
        message: 'Organization access is blocked.',
        state: organization.state,
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
      },
      403,
    )
  if (authorization.reason === 'compliance')
    return context.json(
      {
        code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
        message: 'Current organization compliance is required.',
        state: organization.state,
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
      },
      403,
    )
  if (authorization.reason === 'audience') {
    if (reviewer)
      return context.json(
        {
          code: 'ORGANIZATION_REVIEWER_REQUIRED',
          message: 'Organization reviewer authority is required.',
        },
        403,
      )
    return declaration.audience === 'hr'
      ? context.json(
          {
            code: 'ORGANIZATION_HR_REQUIRED',
            message: 'Organization HR authority is required.',
          },
          403,
        )
      : context.json(
          {
            code: 'ORGANIZATION_MANAGER_REQUIRED',
            message: 'Organization management is required.',
          },
          403,
        )
  }
  return context.json(
    {
      code: 'ORGANIZATION_PERMISSION_REQUIRED',
      message: 'The required organization permission is not granted.',
    },
    403,
  )
}

export function exposeAuthenticatedSessionModuleContext(moduleId: string, sectionId?: string) {
  return createMiddleware<AuthenticatedSessionModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)
    const organization = context.var.moduleOrganizationAuthorization!

    context.set('platform', {
      authorization: {
        strategy: 'authenticated-session',
        userId: session.userId,
      },
      collectionStatus: createPlatformModuleCollectionStatusReads({
        moduleId,
        sectionId,
        organizationVersion: organization.organizationVersion,
      }),
      organization,
    })
    await next()
  })
}

export function exposeOwnedCharacterModuleContext(moduleId: string, sectionId?: string) {
  return createMiddleware<OwnedCharacterModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)

    const { characterId, subjectLifecycleId } = context.var.ownedCharacter
    const organization = context.var.moduleOrganizationAuthorization!
    context.set('platform', {
      authorization: {
        strategy: 'owned-character',
        userId: session.userId,
        characterId,
        subjectLifecycleId,
      },
      collectionStatus: createPlatformModuleCollectionStatusReads({
        moduleId,
        sectionId,
        organizationVersion: organization.organizationVersion,
        characters: [{ characterId, subjectLifecycleId }],
      }),
      organization,
      coreReads: createOwnedCharacterCoreReads({
        userId: session.userId,
        characterId,
        subjectLifecycleId,
      }),
    })
    await next()
  })
}

export function exposeReviewerTargetModuleContext<
  const CommandIds extends readonly PlatformOrganizationCommandId[],
>(
  moduleId: string,
  sectionId: string | undefined,
  commandIds: CommandIds,
  evidenceBinding?: {
    readonly routeId: string
    readonly resourceId: string
    readonly operationId: string
  },
) {
  return createMiddleware<ReviewerTargetModuleEnv<CommandIds>>(async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)
    const reviewerTarget = context.var.organizationReviewerTarget
    if (!reviewerTarget)
      return context.json(
        { code: 'REVIEW_TARGET_NOT_FOUND', message: 'Review target not found.' },
        404,
      )

    const organization = context.var.moduleOrganizationAuthorization!
    const collectionStatus = createPlatformReviewerCollectionStatusReads({
      moduleId,
      sectionId,
      target: reviewerTarget,
    })
    const platform = {
      authorization: {
        strategy: 'authenticated-session',
        userId: session.userId,
      },
      organization,
      collectionStatus,
      reviewerTarget,
      ...(evidenceBinding
        ? {
            evidence: createPlatformReviewerEvidenceReads(
              { moduleId, ...evidenceBinding, target: reviewerTarget },
              collectionStatus,
            ),
          }
        : {}),
      ...(commandIds.length > 0
        ? {
            organizationCommands: createPlatformOrganizationCommandCapabilities(commandIds, {
              actorUserId: session.userId,
              organization,
              target: reviewerTarget,
            }),
          }
        : {}),
    }
    context.set(
      'platform',
      platform as ReviewerTargetModuleEnv<CommandIds>['Variables']['platform'],
    )
    await next()
  })
}

export function exposeReviewerSearchModuleContext() {
  return createMiddleware<ReviewerSearchModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)
    const organization = context.var.moduleOrganizationAuthorization!

    context.set('platform', {
      authorization: {
        strategy: 'authenticated-session',
        userId: session.userId,
      },
      organization,
      reviewerSearch: createPlatformReviewerAccountSearch(organization.organizationVersion),
    })
    await next()
  })
}
