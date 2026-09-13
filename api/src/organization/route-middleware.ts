import type { Context, MiddlewareHandler } from 'hono'
import { env } from '../env.js'
import type { OrganizationSessionEnv } from '../middleware/organization-session.js'
import { resolveOrganizationEntitlementScope } from './access-policy.js'
import { hasCurrentOrganizationManagerAuthority } from './management-authority.js'
import {
  hasCurrentOrganizationHrAuthority,
  hasCurrentOrganizationOwnerAuthority,
} from './role-store.js'

export const requireTrustedOrigin: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  if (context.req.header('Origin') !== env.WEB_ORIGIN)
    return context.json({ code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' }, 403)
  return next()
}

export const requireOrganizationOwner: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) return refusal
  if (!(await hasCurrentOrganizationOwnerAuthority(context.var.session!.userId)))
    return context.json(
      { code: 'ORGANIZATION_OWNER_REQUIRED', message: 'Organization-owner authority is required.' },
      403,
    )
  return next()
}

export const requireRegistrationPolicyOwner: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  if (!(await hasCurrentOrganizationOwnerAuthority(context.var.session!.userId)))
    return context.json(
      { code: 'ORGANIZATION_OWNER_REQUIRED', message: 'Organization-owner authority is required.' },
      403,
    )
  return next()
}

export const requireOrganizationManager: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) return refusal
  if (!(await hasCurrentOrganizationManagerAuthority(context.var.session!.userId)))
    return context.json(
      { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
      403,
    )
  return next()
}

export const requireOrganizationHr: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) return refusal
  if (!(await hasCurrentOrganizationHrAuthority(context.var.session!.userId)))
    return context.json(
      { code: 'ORGANIZATION_HR_REQUIRED', message: 'Organization HR authority is required.' },
      403,
    )
  return next()
}

export const requireOrganizationActivityAccess: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const organization = context.var.organization!
  if (organization.blocked)
    return context.json(
      {
        code: 'ORGANIZATION_MEMBER_BLOCKED',
        message: 'Organization access is blocked.',
        state: organization.state,
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
      },
      403,
    )
  if (resolveOrganizationEntitlementScope(organization) === 'none')
    return context.json(
      {
        code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
        message: 'Current organization compliance is required.',
        state: organization.state,
        reviewDeadline: organization.reviewDeadline?.toISOString() ?? null,
      },
      403,
    )
  return next()
}

function organizationComplianceRefusal(context: Context<OrganizationSessionEnv>) {
  const organization = context.var.organization
  if (
    organization &&
    !organization.blocked &&
    organization.state === 'compliant' &&
    organization.accessValidUntil !== null &&
    organization.accessValidUntil > new Date()
  )
    return null
  return context.json(
    {
      code: organization?.blocked
        ? ('ORGANIZATION_MEMBER_BLOCKED' as const)
        : ('ORGANIZATION_COMPLIANCE_REQUIRED' as const),
      message: organization?.blocked
        ? 'Organization access is blocked.'
        : 'Current organization compliance is required.',
      state: organization?.state ?? ('pending' as const),
      reviewDeadline: organization?.reviewDeadline?.toISOString() ?? null,
    },
    403,
  )
}
