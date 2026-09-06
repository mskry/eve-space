import type {
  PlatformAuthorizedOrganizationContext,
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOrganizationContributionAuthorization,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { createMiddleware } from 'hono/factory'
import { authRequiredBody } from '../http/contracts.js'
import { createOwnedCharacterCoreReads } from '../platform/core-read-capabilities.js'
import { authorizeOrganizationContribution } from '../organization/module-authorization.js'
import type { OrganizationSessionEnv } from './organization-session.js'
import type { OwnedCharacterEnv } from './owned-character.js'

export type ModuleOrganizationAuthorizationEnv = {
  Variables: OrganizationSessionEnv['Variables'] & {
    moduleOrganizationAuthorization: PlatformAuthorizedOrganizationContext | null
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

export function requireModuleOrganizationAuthorization(
  declaration: PlatformOrganizationContributionAuthorization,
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

    const authorization = await authorizeOrganizationContribution(
      session.userId,
      organization,
      declaration,
    )
    if (!authorization.authorized) {
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
      if (authorization.reason === 'audience')
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
      return context.json(
        {
          code: 'ORGANIZATION_PERMISSION_REQUIRED',
          message: 'The required organization permission is not granted.',
        },
        403,
      )
    }

    context.set('moduleOrganizationAuthorization', authorization.context)
    await next()
  })
}

export const exposeAuthenticatedSessionModuleContext =
  createMiddleware<AuthenticatedSessionModuleEnv>(async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)

    context.set('platform', {
      authorization: {
        strategy: 'authenticated-session',
        userId: session.userId,
      },
      organization: context.var.moduleOrganizationAuthorization!,
    })
    await next()
  })

export const exposeOwnedCharacterModuleContext = createMiddleware<OwnedCharacterModuleEnv>(
  async (context, next) => {
    const session = context.var.session
    if (!session) return context.json(authRequiredBody, 401)

    const { characterId, subjectLifecycleId } = context.var.ownedCharacter
    context.set('platform', {
      authorization: {
        strategy: 'owned-character',
        userId: session.userId,
        characterId,
        subjectLifecycleId,
      },
      organization: context.var.moduleOrganizationAuthorization!,
      coreReads: createOwnedCharacterCoreReads({
        userId: session.userId,
        characterId,
        subjectLifecycleId,
      }),
    })
    await next()
  },
)
