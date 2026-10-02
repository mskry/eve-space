import type {
  PlatformAuthorizedOrganizationContext,
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOrganizationCommandId,
  PlatformOwnedCharacterRouteEnv,
  PlatformOnDemandStructureRequester,
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledOrganizationContributionAuthorization } from '@eve-space/platform-module-contract/installed'
import { createMiddleware } from 'hono/factory'
import { authRequiredBody } from '../http/contracts.js'
import {
  createAuthenticatedSessionModuleContext,
  createOwnedCharacterModuleContext,
} from '../platform/module-context-capabilities.js'
import { createPlatformReviewerCollectionStatusReads } from '../platform/module-reviewer-collection-status-capabilities.js'
import { createPlatformReviewerEvidenceSummaryReads } from '../platform/module-reviewer-evidence-summary-capabilities.js'
import { createPlatformReviewerEvidenceReads } from '../platform/module-reviewer-evidence-capabilities.js'
import { createPlatformOrganizationCommandCapabilities } from '../platform/module-organization-command-capabilities.js'
import { createPlatformReviewerAccountSearch } from '../platform/reviewer-search-capabilities.js'
import type { OrganizationContributionAuthorizationResult } from '../organization/module-authorization.js'
import { admitOrganizationRead } from '../organization/read-admission.js'
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

const requireOrganizationAuthorization = (
  declaration: PlatformInstalledOrganizationContributionAuthorization,
  reviewer: boolean,
) => {
  return createMiddleware<ModuleOrganizationAuthorizationEnv>(async (context, next) => {
    const authorization = await admitOrganizationRead(
      context.var.session,
      context.var.organization ?? null,
      declaration,
      reviewer,
    )
    if (!authorization.admitted) {
      context.set('moduleOrganizationAuthorizationDenialReason', authorization.reason)
      return context.json(authorization.body, authorization.status)
    }

    context.set('moduleOrganizationAuthorization', authorization.organization)
    await next()
  })
}

export const requireModuleOrganizationAuthorization = (
  declaration: PlatformInstalledOrganizationContributionAuthorization,
) => requireOrganizationAuthorization(declaration, false)

export const requireModuleReviewerAuthorization = (
  declaration: PlatformInstalledOrganizationContributionAuthorization,
) => requireOrganizationAuthorization(declaration, true)

export const exposeAuthenticatedSessionModuleContext = (moduleId: string, sectionId?: string) => {
  return createMiddleware<AuthenticatedSessionModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) {
      return context.json(authRequiredBody, 401)
    }
    const organization = context.var.moduleOrganizationAuthorization!

    context.set(
      'platform',
      createAuthenticatedSessionModuleContext(moduleId, session.userId, organization, sectionId),
    )
    await next()
  })
}

export const exposeOwnedCharacterModuleContext = (
  moduleId: string,
  sectionId?: string,
  onDemand?: PlatformOnDemandStructureRequester,
) => {
  return createMiddleware<OwnedCharacterModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) {
      return context.json(authRequiredBody, 401)
    }

    const { characterId, subjectLifecycleId } = context.var.ownedCharacter
    const organization = context.var.moduleOrganizationAuthorization!
    context.set(
      'platform',
      createOwnedCharacterModuleContext(
        moduleId,
        { userId: session.userId, characterId, subjectLifecycleId },
        organization,
        sectionId,
        onDemand,
      ),
    )
    await next()
  })
}

export function exposeReviewerTargetModuleContext<
  const CommandIds extends readonly PlatformOrganizationCommandId[],
>(
  publisherPackage: string,
  moduleId: string,
  sectionId: string | undefined,
  commandIds: CommandIds,
  evidenceBinding?: {
    readonly routeId: string
    readonly resources: readonly { readonly resourceId: string; readonly field: string | null }[]
    readonly operationId: string
  },
  contribution?: {
    readonly contributionId: string
    readonly resourceIds: readonly string[]
  },
) {
  return createMiddleware<ReviewerTargetModuleEnv<CommandIds>>(async (context, next) => {
    const session = context.var.session
    if (!session) {
      return context.json(authRequiredBody, 401)
    }
    const reviewerTarget = context.var.organizationReviewerTarget
    if (!reviewerTarget) {
      return context.json(
        { code: 'REVIEW_TARGET_NOT_FOUND', message: 'Review target not found.' },
        404,
      )
    }

    const organization = context.var.moduleOrganizationAuthorization!
    const collectionStatus = createPlatformReviewerCollectionStatusReads({
      moduleId,
      sectionId,
      ...(contribution && { resourceIds: contribution.resourceIds }),
      target: reviewerTarget,
    })
    const platform = {
      authorization: {
        strategy: 'authenticated-session',
        userId: session.userId,
      },
      collectionStatus,
      evidenceSummary: createPlatformReviewerEvidenceSummaryReads({
        moduleId,
        ...(contribution && { sectionId, resourceIds: contribution.resourceIds }),
        target: reviewerTarget,
      }),
      organization,
      reviewerTarget,
      ...(evidenceBinding && {
        evidence: createPlatformReviewerEvidenceReads(
          { moduleId, ...evidenceBinding, target: reviewerTarget },
          collectionStatus,
        ),
      }),
      ...(commandIds.length > 0 && {
        organizationCommands: createPlatformOrganizationCommandCapabilities(commandIds, {
          actorUserId: session.userId,
          moduleId,
          organization,
          publisherPackage,
          target: reviewerTarget,
        }),
      }),
    }
    context.set(
      'platform',
      platform as ReviewerTargetModuleEnv<CommandIds>['Variables']['platform'],
    )
    await next()
  })
}

export function exposeReviewerSearchModuleContext(moduleId: string) {
  return createMiddleware<ReviewerSearchModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) {
      return context.json(authRequiredBody, 401)
    }
    const organization = context.var.moduleOrganizationAuthorization!

    context.set('platform', {
      authorization: {
        strategy: 'authenticated-session',
        userId: session.userId,
      },
      organization,
      reviewerSearch: createPlatformReviewerAccountSearch(
        moduleId,
        organization.organizationVersion,
      ),
    })
    await next()
  })
}
