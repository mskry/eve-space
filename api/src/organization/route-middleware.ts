import type { Context, MiddlewareHandler } from 'hono'
import { env } from '../env.js'
import type { OrganizationSessionEnv } from '../middleware/organization-session.js'
import { resolveOrganizationEntitlementScope } from './access-policy.js'
import { hasCurrentOrganizationManagerAuthority } from './management-authority.js'
import {
  hasCurrentOrganizationHrAuthority,
  hasCurrentOrganizationOwnerAuthority,
  loadCurrentOrganizationAuthorityForUser,
} from './role-store.js'

export const requireTrustedOrigin: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  if (context.req.header('Origin') !== env.WEB_ORIGIN) {
    return context.json({ code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' }, 403)
  }
  return next()
}

export const requireOrganizationOwner: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) {
    return refusal
  }
  if (!(await hasCurrentOrganizationOwnerAuthority(context.var.session!.userId))) {
    return context.json(
      { code: 'ORGANIZATION_OWNER_REQUIRED', message: 'Organization-owner authority is required.' },
      403,
    )
  }
  return next()
}

export const requireRegistrationPolicyOwner: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const userId = context.var.session!.userId
  const authority = await loadCurrentOrganizationAuthorityForUser(userId)
  const refusal = freshOwnerRefusal(context, authority)
  if (refusal) {
    return refusal
  }
  return next()
}

export const requireFreshOrganizationOwner: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) {
    return refusal
  }
  const userId = context.var.session!.userId
  const authority = await loadCurrentOrganizationAuthorityForUser(userId)
  const authorityRefusal = freshOwnerRefusal(context, authority)
  if (authorityRefusal) {
    return authorityRefusal
  }
  return next()
}

export const requireOrganizationOwnerRemediation: MiddlewareHandler<
  OrganizationSessionEnv
> = async (context, next) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) {
    return refusal
  }
  const authority = await loadCurrentOrganizationAuthorityForUser(
    context.var.session!.userId,
    new Date(),
    'remediate',
  )
  if (!authority?.organizationOwner) {
    return context.json(
      {
        code: 'ORGANIZATION_OWNER_REPLACEMENT_REQUIRED',
        message: 'A current organization-owner source must authorize replacement.',
      },
      409,
    )
  }
  return next()
}

export const requireOrganizationManager: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) {
    return refusal
  }
  if (!(await hasCurrentOrganizationManagerAuthority(context.var.session!.userId))) {
    return context.json(
      { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
      403,
    )
  }
  return next()
}

export const requireFreshOrganizationManager: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) {
    return refusal
  }
  const userId = context.var.session!.userId
  const authority = await loadCurrentOrganizationAuthorityForUser(userId)
  if (!authority) {
    return context.json(
      { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
      403,
    )
  }
  if (
    authority.explicitDirector ||
    authority.ownerSource?.state === 'fresh' ||
    authority.derivedSources.some(({ state }) => state === 'fresh')
  ) {
    return next()
  }
  if (authority.organizationOwner || authority.director) {
    return degradedAuthorityRefusal(context)
  }
  if (
    authority.ownerSource?.state === 'invalid' ||
    authority.derivedSources.some(({ state }) => state === 'invalid')
  ) {
    return invalidAuthoritySourceRefusal(context)
  }
  if (!(await hasCurrentOrganizationManagerAuthority(userId, 'mutate'))) {
    return context.json(
      { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
      403,
    )
  }
  return next()
}

export const requireOrganizationManagerRemediation: MiddlewareHandler<
  OrganizationSessionEnv
> = async (context, next) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) {
    return refusal
  }
  const authority = await loadCurrentOrganizationAuthorityForUser(
    context.var.session!.userId,
    new Date(),
    'remediate',
  )
  if (authority?.organizationOwner || authority?.director) {
    return next()
  }
  if (
    authority?.ownerSource?.state === 'invalid' ||
    authority?.derivedSources.some(({ state }) => state === 'invalid')
  ) {
    return invalidAuthoritySourceRefusal(context)
  }
  return context.json(
    { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
    403,
  )
}

export const requireOrganizationHr: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const refusal = organizationComplianceRefusal(context)
  if (refusal) {
    return refusal
  }
  if (!(await hasCurrentOrganizationHrAuthority(context.var.session!.userId))) {
    return context.json(
      { code: 'ORGANIZATION_HR_REQUIRED', message: 'Organization HR authority is required.' },
      403,
    )
  }
  return next()
}

export const requireOrganizationActivityAccess: MiddlewareHandler<OrganizationSessionEnv> = async (
  context,
  next,
) => {
  const organization = context.var.organization!
  if (organization.blocked) {
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
  if (resolveOrganizationEntitlementScope(organization) === 'none') {
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
  ) {
    return null
  }
  return context.json(
    {
      code: organization?.blocked
        ? ('ORGANIZATION_MEMBER_BLOCKED' as const)
        : ('ORGANIZATION_COMPLIANCE_REQUIRED' as const),
      message: organization?.blocked
        ? 'Organization access is blocked.'
        : 'Current organization compliance is required.',
      reviewDeadline: organization?.reviewDeadline?.toISOString() ?? null,
      state: organization?.state ?? ('pending' as const),
    },
    403,
  )
}

function degradedAuthorityRefusal(context: Context<OrganizationSessionEnv>) {
  return context.json(
    {
      code: 'ORGANIZATION_AUTHORITY_DEGRADED',
      message: 'Fresh organization authority is required for this operation.',
    },
    409,
  )
}

function invalidAuthoritySourceRefusal(context: Context<OrganizationSessionEnv>) {
  return context.json(
    {
      code: 'ORGANIZATION_AUTHORITY_SOURCE_INVALID',
      message: 'The designated organization authority source is no longer valid.',
    },
    409,
  )
}

function freshOwnerRefusal(
  context: Context<OrganizationSessionEnv>,
  authority: Awaited<ReturnType<typeof loadCurrentOrganizationAuthorityForUser>>,
) {
  if (authority?.ownerSource?.state === 'fresh') {
    return null
  }
  if (authority?.ownerSource?.state === 'degraded') {
    return degradedAuthorityRefusal(context)
  }
  if (authority?.ownerSource?.state === 'invalid') {
    return invalidAuthoritySourceRefusal(context)
  }
  return context.json(
    { code: 'ORGANIZATION_OWNER_REQUIRED', message: 'Organization-owner authority is required.' },
    403,
  )
}
