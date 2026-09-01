import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { organizationComplianceSources } from '../db/schema.js'
import { env } from '../env.js'
import { zValidator } from '../http/validation.js'
import { loadSession, requireSession, type SessionEnv } from '../middleware/auth-session.js'
import {
  blockOrganizationMember,
  listCurrentOrganizationMemberBlocks,
  OrganizationMemberBlockMutationError,
  unblockOrganizationMember,
} from './block-store.js'
import {
  OrganizationCorporationSourceMutationError,
  registerOrganizationCorporationSource,
} from './corporation-sources.js'
import {
  assignOrganizationGroup,
  createOrganizationGroup,
  createOrganizationPermissionBundle,
  hasCurrentOrganizationManagerAuthority,
  listCurrentOrganizationGroups,
  OrganizationGroupMutationError,
  revokeOrganizationGroupAssignment,
} from './group-store.js'
import {
  grantOrganizationRole,
  getOrganizationAccessContext,
  hasCurrentOrganizationOwnerAuthority,
  hasCurrentOrganizationHrAuthority,
  listCurrentOrganizationRoles,
  OrganizationRoleMutationError,
  revokeOrganizationRole,
} from './role-store.js'
import { listOrganizationRosterCoverage } from './roster-coverage.js'

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
const permissionKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z][a-z0-9.:-]*$/)
  .refine(
    (key) => key.split(/[.:]/).every((segment) => segment.length > 0 && !segment.endsWith('-')),
    'Enter a valid permission key.',
  )
const permissionBundleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    permissions: z
      .array(z.object({ type: z.enum(['module', 'service']), key: permissionKeySchema }).strict())
      .min(1)
      .max(100),
  })
  .strict()
const groupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    restricted: z.boolean(),
    managementMode: z.enum(['manual', 'compliance']),
    complianceSource: z.enum(organizationComplianceSources).nullable(),
    bundleIds: z.array(z.uuid()).min(1).max(50),
  })
  .strict()
  .superRefine((group, context) => {
    if (group.managementMode === 'manual' && group.complianceSource !== null)
      context.addIssue({
        code: 'custom',
        path: ['complianceSource'],
        message: 'Manual groups cannot declare a compliance source.',
      })
    if (group.managementMode === 'compliance' && group.complianceSource === null)
      context.addIssue({
        code: 'custom',
        path: ['complianceSource'],
        message: 'Compliance groups require a source.',
      })
  })
const groupParamsSchema = z.object({ groupId: z.uuid('Enter a valid group ID.') })
const assignmentParamsSchema = z.object({
  groupId: z.uuid('Enter a valid group ID.'),
  assignmentId: z.uuid('Enter a valid assignment ID.'),
})
const assignGroupSchema = z
  .object({
    userId: z.uuid('Enter a valid user ID.'),
    reason: reasonSchema,
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
const memberParamsSchema = z.object({ userId: z.uuid('Enter a valid user ID.') })
const corporationParamsSchema = z.object({
  corporationId: z.coerce.number().int().positive().safe(),
})
const corporationSourceSchema = z
  .object({ characterId: z.number().int().positive().safe() })
  .strict()

const requireTrustedOrigin: MiddlewareHandler<SessionEnv> = async (context, next) => {
  if (context.req.header('Origin') !== env.WEB_ORIGIN)
    return context.json({ code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' }, 403)
  return next()
}

const requireOrganizationOwner: MiddlewareHandler<SessionEnv> = async (context, next) => {
  if (!(await hasCurrentOrganizationOwnerAuthority(context.var.session!.userId)))
    return context.json(
      { code: 'ORGANIZATION_OWNER_REQUIRED', message: 'Organization-owner authority is required.' },
      403,
    )
  return next()
}

const requireOrganizationManager: MiddlewareHandler<SessionEnv> = async (context, next) => {
  if (!(await hasCurrentOrganizationManagerAuthority(context.var.session!.userId)))
    return context.json(
      { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
      403,
    )
  return next()
}

const requireOrganizationHr: MiddlewareHandler<SessionEnv> = async (context, next) => {
  if (!(await hasCurrentOrganizationHrAuthority(context.var.session!.userId)))
    return context.json(
      { code: 'ORGANIZATION_HR_REQUIRED', message: 'Organization HR authority is required.' },
      403,
    )
  return next()
}

const privateNoStore: MiddlewareHandler<SessionEnv> = async (context, next) => {
  context.header('Cache-Control', 'private, no-store')
  await next()
}

export const organizationRoutes = new Hono<SessionEnv>()
  .use('*', privateNoStore, loadSession, requireSession)
  .get('/context', async (context) =>
    context.json(await getOrganizationAccessContext(context.var.session!.userId)),
  )
  .get('/roles', requireOrganizationOwner, async (context) =>
    context.json(await listCurrentOrganizationRoles()),
  )
  .get('/roster-coverage', requireOrganizationHr, async (context) =>
    context.json(await listOrganizationRosterCoverage()),
  )
  .post(
    '/roles',
    requireTrustedOrigin,
    requireOrganizationOwner,
    zValidator('json', grantRoleSchema),
    async (context) => {
      try {
        const grant = await grantOrganizationRole({
          actorUserId: context.var.session!.userId,
          targetUserId: context.req.valid('json').userId,
          role: context.req.valid('json').role,
          reason: context.req.valid('json').reason,
        })
        return context.json({ grant }, 201)
      } catch (error) {
        return roleMutationFailure(context, error)
      }
    },
  )
  .put(
    '/corporations/:corporationId/source',
    requireTrustedOrigin,
    requireOrganizationManager,
    zValidator('param', corporationParamsSchema),
    zValidator('json', corporationSourceSchema),
    async (context) => {
      try {
        const result = await registerOrganizationCorporationSource({
          actorUserId: context.var.session!.userId,
          corporationId: context.req.valid('param').corporationId,
          characterId: context.req.valid('json').characterId,
        })
        return context.json(result, result.replaced ? 200 : 201)
      } catch (error) {
        return corporationSourceMutationFailure(context, error)
      }
    },
  )
  .get('/groups', requireOrganizationManager, async (context) =>
    context.json(await listCurrentOrganizationGroups()),
  )
  .get('/member-blocks', requireOrganizationManager, async (context) =>
    context.json(await listCurrentOrganizationMemberBlocks()),
  )
  .post(
    '/permission-bundles',
    requireTrustedOrigin,
    requireOrganizationOwner,
    zValidator('json', permissionBundleSchema),
    async (context) => {
      try {
        const bundle = await createOrganizationPermissionBundle({
          actorUserId: context.var.session!.userId,
          ...context.req.valid('json'),
        })
        return context.json({ bundle }, 201)
      } catch (error) {
        return groupMutationFailure(context, error)
      }
    },
  )
  .post(
    '/groups',
    requireTrustedOrigin,
    requireOrganizationOwner,
    zValidator('json', groupSchema),
    async (context) => {
      try {
        const group = await createOrganizationGroup({
          actorUserId: context.var.session!.userId,
          ...context.req.valid('json'),
        })
        return context.json({ group }, 201)
      } catch (error) {
        return groupMutationFailure(context, error)
      }
    },
  )
  .post(
    '/groups/:groupId/assignments',
    requireTrustedOrigin,
    requireOrganizationManager,
    zValidator('param', groupParamsSchema),
    zValidator('json', assignGroupSchema),
    async (context) => {
      try {
        const body = context.req.valid('json')
        const assignment = await assignOrganizationGroup({
          actorUserId: context.var.session!.userId,
          groupId: context.req.valid('param').groupId,
          targetUserId: body.userId,
          reason: body.reason,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        })
        return context.json({ assignment }, 201)
      } catch (error) {
        return groupMutationFailure(context, error)
      }
    },
  )
  .post(
    '/groups/:groupId/assignments/:assignmentId/revoke',
    requireTrustedOrigin,
    requireOrganizationManager,
    zValidator('param', assignmentParamsSchema),
    zValidator('json', revokeRoleSchema),
    async (context) => {
      try {
        const assignment = await revokeOrganizationGroupAssignment({
          actorUserId: context.var.session!.userId,
          groupId: context.req.valid('param').groupId,
          assignmentId: context.req.valid('param').assignmentId,
          reason: context.req.valid('json').reason,
        })
        return context.json({ assignment })
      } catch (error) {
        return groupMutationFailure(context, error)
      }
    },
  )
  .post(
    '/members/:userId/block',
    requireTrustedOrigin,
    requireOrganizationManager,
    zValidator('param', memberParamsSchema),
    zValidator('json', revokeRoleSchema),
    async (context) => {
      try {
        const block = await blockOrganizationMember({
          actorUserId: context.var.session!.userId,
          targetUserId: context.req.valid('param').userId,
          reason: context.req.valid('json').reason,
        })
        return context.json({ block }, 201)
      } catch (error) {
        return memberBlockMutationFailure(context, error)
      }
    },
  )
  .post(
    '/members/:userId/unblock',
    requireTrustedOrigin,
    requireOrganizationManager,
    zValidator('param', memberParamsSchema),
    zValidator('json', revokeRoleSchema),
    async (context) => {
      try {
        const block = await unblockOrganizationMember({
          actorUserId: context.var.session!.userId,
          targetUserId: context.req.valid('param').userId,
          reason: context.req.valid('json').reason,
        })
        return context.json({ block })
      } catch (error) {
        return memberBlockMutationFailure(context, error)
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

function groupMutationFailure(context: Context, error: unknown) {
  if (!(error instanceof OrganizationGroupMutationError)) throw error
  switch (error.code) {
    case 'manager-authority-required':
      return context.json(
        { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
        403,
      )
    case 'owner-authority-required':
      return context.json(
        {
          code: 'ORGANIZATION_OWNER_REQUIRED',
          message: 'Organization-owner authority is required.',
        },
        403,
      )
    case 'bundle-name-conflict':
      return context.json(
        { code: 'PERMISSION_BUNDLE_EXISTS', message: 'A permission bundle has this name.' },
        409,
      )
    case 'bundle-not-found':
      return context.json(
        { code: 'PERMISSION_BUNDLE_NOT_FOUND', message: 'Permission bundle not found.' },
        404,
      )
    case 'group-name-conflict':
      return context.json(
        { code: 'ORGANIZATION_GROUP_EXISTS', message: 'A group has this name.' },
        409,
      )
    case 'group-not-found':
      return context.json(
        { code: 'ORGANIZATION_GROUP_NOT_FOUND', message: 'Group not found.' },
        404,
      )
    case 'target-not-found':
      return context.json({ code: 'USER_NOT_FOUND', message: 'User not found.' }, 404)
    case 'compliance-group-manual-change':
      return context.json(
        {
          code: 'COMPLIANCE_GROUP_MANAGED',
          message: 'Compliance-managed memberships cannot be changed manually.',
        },
        409,
      )
    case 'compliance-source-mismatch':
      return context.json(
        { code: 'COMPLIANCE_SOURCE_MISMATCH', message: 'Compliance source does not match.' },
        409,
      )
    case 'assignment-already-active':
      return context.json(
        { code: 'GROUP_ASSIGNMENT_EXISTS', message: 'This group assignment is already active.' },
        409,
      )
    case 'assignment-not-found':
      return context.json(
        { code: 'GROUP_ASSIGNMENT_NOT_FOUND', message: 'Group assignment not found.' },
        404,
      )
    case 'invalid-expiry':
      return context.json(
        { code: 'INVALID_GROUP_EXPIRY', message: 'Group expiry must be in the future.' },
        400,
      )
  }
}

function memberBlockMutationFailure(context: Context, error: unknown) {
  if (!(error instanceof OrganizationMemberBlockMutationError)) throw error
  switch (error.code) {
    case 'manager-authority-required':
      return context.json(
        { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
        403,
      )
    case 'target-not-found':
      return context.json({ code: 'USER_NOT_FOUND', message: 'User not found.' }, 404)
    case 'self-block-not-allowed':
      return context.json(
        { code: 'MEMBER_SELF_BLOCK_NOT_ALLOWED', message: 'Managers cannot block themselves.' },
        409,
      )
    case 'owner-block-not-allowed':
      return context.json(
        {
          code: 'ORGANIZATION_OWNER_BLOCK_NOT_ALLOWED',
          message: 'The current organization owner cannot be blocked.',
        },
        409,
      )
    case 'block-already-active':
      return context.json(
        { code: 'MEMBER_BLOCK_EXISTS', message: 'This member is already blocked.' },
        409,
      )
    case 'block-not-found':
      return context.json(
        { code: 'MEMBER_BLOCK_NOT_FOUND', message: 'Member block not found.' },
        404,
      )
  }
}

function corporationSourceMutationFailure(context: Context, error: unknown) {
  if (!(error instanceof OrganizationCorporationSourceMutationError)) throw error
  switch (error.code) {
    case 'manager-authority-required':
      return context.json(
        { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
        403,
      )
    case 'corporation-not-managed':
      return context.json(
        { code: 'MANAGED_CORPORATION_NOT_FOUND', message: 'Managed corporation not found.' },
        404,
      )
    case 'source-character-ineligible':
      return context.json(
        {
          code: 'CORPORATION_SOURCE_INELIGIBLE',
          message: 'The selected character is not eligible as this corporation data source.',
        },
        409,
      )
  }
}
