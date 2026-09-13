import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { zValidator } from '../http/validation.js'
import type { OrganizationSessionEnv } from '../middleware/organization-session.js'
import {
  maximumStaleEvidenceGraceDurationSeconds,
  maximumStrictRemediationDurationSeconds,
} from './registration-policy.js'
import {
  OrganizationRegistrationPolicyMutationError,
  updateOrganizationRegistrationPolicy,
} from './policy-store.js'
import {
  grantOrganizationRole,
  listCurrentOrganizationRoles,
  OrganizationRoleMutationError,
  revokeOrganizationRole,
} from './role-store.js'
import {
  requireOrganizationOwner,
  requireRegistrationPolicyOwner,
  requireTrustedOrigin,
} from './route-middleware.js'

const reasonSchema = z.string().trim().min(1, 'A reason is required.').max(2000)
const grantRoleSchema = z
  .object({
    userId: z.uuid('Enter a valid user ID.'),
    role: z.enum(['hr_auditor', 'director']),
    reason: reasonSchema,
  })
  .strict()
const grantParamsSchema = z.object({ grantId: z.uuid('Enter a valid role grant ID.') })
const revokeRoleSchema = z.object({ reason: reasonSchema }).strict()
const registrationPolicySchema = z
  .object({
    requiredScopes: z.array(z.string().trim().min(1).max(200)).max(100),
    strictRemediationDurationSeconds: z
      .number()
      .int()
      .min(0)
      .max(maximumStrictRemediationDurationSeconds),
    staleEvidenceGraceDurationSeconds: z
      .number()
      .int()
      .min(0)
      .max(maximumStaleEvidenceGraceDurationSeconds),
    reason: reasonSchema,
  })
  .strict()

export const organizationGovernanceRoutes = new Hono<OrganizationSessionEnv>()
  .get('/roles', requireOrganizationOwner, async (context) =>
    context.json(await listCurrentOrganizationRoles()),
  )
  .post(
    '/roles',
    requireTrustedOrigin,
    requireOrganizationOwner,
    zValidator('json', grantRoleSchema),
    async (context) => {
      try {
        const body = context.req.valid('json')
        const grant = await grantOrganizationRole({
          actorUserId: context.var.session!.userId,
          targetUserId: body.userId,
          role: body.role,
          reason: body.reason,
        })
        return context.json({ grant }, 201)
      } catch (error) {
        return roleMutationFailure(context, error)
      }
    },
  )
  .put(
    '/registration-policy',
    requireTrustedOrigin,
    requireRegistrationPolicyOwner,
    zValidator('json', registrationPolicySchema),
    async (context) => {
      try {
        const policy = await updateOrganizationRegistrationPolicy({
          actorUserId: context.var.session!.userId,
          ...context.req.valid('json'),
        })
        return context.json({ policy })
      } catch (error) {
        return registrationPolicyMutationFailure(context, error)
      }
    },
  )
  .post(
    '/roles/:grantId/revoke',
    requireTrustedOrigin,
    requireOrganizationOwner,
    zValidator('param', grantParamsSchema),
    zValidator('json', revokeRoleSchema),
    async (context) => {
      try {
        const grant = await revokeOrganizationRole({
          actorUserId: context.var.session!.userId,
          grantId: context.req.valid('param').grantId,
          reason: context.req.valid('json').reason,
        })
        return context.json({ grant })
      } catch (error) {
        return roleMutationFailure(context, error)
      }
    },
  )

function roleMutationFailure(context: Context, error: unknown) {
  if (!(error instanceof OrganizationRoleMutationError)) throw error
  switch (error.code) {
    case 'owner-authority-required':
      return context.json(
        {
          code: 'ORGANIZATION_OWNER_REQUIRED',
          message: 'Organization-owner authority is required.',
        },
        403,
      )
    case 'target-not-found':
      return context.json({ code: 'USER_NOT_FOUND', message: 'User not found.' }, 404)
    case 'role-already-granted':
      return context.json(
        { code: 'ORGANIZATION_ROLE_EXISTS', message: 'This role is already active.' },
        409,
      )
    case 'grant-not-found':
      return context.json({ code: 'ROLE_GRANT_NOT_FOUND', message: 'Role grant not found.' }, 404)
  }
}

function registrationPolicyMutationFailure(context: Context, error: unknown) {
  if (!(error instanceof OrganizationRegistrationPolicyMutationError)) throw error
  if (error.code === 'owner-authority-required')
    return context.json(
      { code: 'ORGANIZATION_OWNER_REQUIRED', message: 'Organization-owner authority is required.' },
      403,
    )
  if (error.code === 'owner-policy-noncompliant')
    return context.json(
      {
        code: 'REGISTRATION_POLICY_OWNER_NONCOMPLIANT',
        message: 'The organization owner must satisfy the proposed registration policy.',
      },
      409,
    )
  return context.json({ code: 'INVALID_REGISTRATION_POLICY', message: 'Policy is invalid.' }, 400)
}
