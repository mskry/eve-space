import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { organizationComplianceSources } from '../db/schema.js'
import { zValidator } from '../http/validation.js'
import type { OrganizationSessionEnv } from '../middleware/organization-session.js'
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
  listCurrentOrganizationPermissionBundles,
  listCurrentOrganizationGroups,
  revokeOrganizationGroupAssignment,
  updateOrganizationPermissionBundle,
} from './group-store.js'
import { OrganizationGroupMutationError } from './group-mutation-error.js'
import {
  requireOrganizationManager,
  requireOrganizationOwner,
  requireFreshOrganizationManager,
  requireFreshOrganizationOwner,
  requireTrustedOrigin,
} from './route-middleware.js'
import {
  listEnabledPermissionCatalog,
  OrganizationPermissionCatalogError,
  previewEnabledPermissionProfile,
} from './permission-catalog-store.js'

const reasonSchema = z.string().trim().min(1, 'A reason is required.').max(2000)
const revokeSchema = z.object({ reason: reasonSchema }).strict()
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
const publisherPackageSchema = z.string().trim().min(1).max(214)
const moduleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(44)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const permissionSelectionSchema = z.discriminatedUnion('type', [
  z
    .object({
      key: permissionKeySchema,
      moduleId: moduleIdSchema,
      publisherPackage: publisherPackageSchema,
      type: z.literal('module'),
    })
    .strict(),
  z
    .object({
      key: permissionKeySchema,
      reviewAllowed: z.boolean().optional(),
      type: z.literal('service'),
    })
    .strict(),
])
const permissionBundleCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    permissions: z.array(permissionSelectionSchema).min(1).max(100),
    reason: reasonSchema,
  })
  .strict()
const retainedUnavailableEntryIdsSchema = z
  .array(z.uuid('Enter a valid retained permission entry ID.'))
  .max(100)
  .refine((entryIds) => new Set(entryIds).size === entryIds.length, {
    message: 'Retained permission entry IDs must be unique.',
  })
const permissionBundleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    permissions: z.array(permissionSelectionSchema).max(100),
    reason: reasonSchema,
    retainedUnavailableEntryIds: retainedUnavailableEntryIdsSchema,
  })
  .strict()
const permissionBundleParamsSchema = z.object({ bundleId: z.uuid('Enter a valid bundle ID.') })
const permissionProfilePreviewSchema = z
  .object({
    moduleId: moduleIdSchema,
    profileId: moduleIdSchema,
    publisherPackage: publisherPackageSchema,
  })
  .strict()
const groupSchema = z
  .object({
    bundleIds: z.array(z.uuid()).min(1).max(50),
    complianceSource: z.enum(organizationComplianceSources).nullable(),
    managementMode: z.enum(['manual', 'compliance']),
    name: z.string().trim().min(1).max(100),
    restricted: z.boolean(),
  })
  .strict()
  .superRefine((group, context) => {
    if (group.managementMode === 'manual' && group.complianceSource !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Manual groups cannot declare a compliance source.',
        path: ['complianceSource'],
      })
    }
    if (group.managementMode === 'compliance' && group.complianceSource === null) {
      context.addIssue({
        code: 'custom',
        message: 'Compliance groups require a source.',
        path: ['complianceSource'],
      })
    }
  })
const groupParamsSchema = z.object({ groupId: z.uuid('Enter a valid group ID.') })
const assignmentParamsSchema = z.object({
  assignmentId: z.uuid('Enter a valid assignment ID.'),
  groupId: z.uuid('Enter a valid group ID.'),
})
const assignGroupSchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    reason: reasonSchema,
    userId: z.uuid('Enter a valid user ID.'),
  })
  .strict()
const memberParamsSchema = z.object({ userId: z.uuid('Enter a valid user ID.') })
const corporationParamsSchema = z.object({ corporationId: z.coerce.number().int().positive() })
const corporationSourceSchema = z.object({ characterId: z.number().int().positive() }).strict()

export const organizationManagementRoutes = new Hono<OrganizationSessionEnv>()
  .put(
    '/corporations/:corporationId/source',
    requireTrustedOrigin,
    requireFreshOrganizationManager,
    zValidator('param', corporationParamsSchema),
    zValidator('json', corporationSourceSchema),
    async (context) => {
      try {
        const result = await registerOrganizationCorporationSource({
          actorUserId: context.var.session!.userId,
          characterId: context.req.valid('json').characterId,
          corporationId: context.req.valid('param').corporationId,
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
  .get('/permission-catalog', requireOrganizationOwner, async (context) =>
    context.json(await listEnabledPermissionCatalog()),
  )
  .get('/permission-bundles', requireOrganizationOwner, async (context) =>
    context.json(await listCurrentOrganizationPermissionBundles(context.var.session!.userId)),
  )
  .get('/member-blocks', requireOrganizationManager, async (context) =>
    context.json(await listCurrentOrganizationMemberBlocks()),
  )
  .post(
    '/permission-bundles',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
    zValidator('json', permissionBundleCreateSchema),
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
  .put(
    '/permission-bundles/:bundleId',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
    zValidator('param', permissionBundleParamsSchema),
    zValidator('json', permissionBundleUpdateSchema),
    async (context) => {
      try {
        const bundle = await updateOrganizationPermissionBundle({
          actorUserId: context.var.session!.userId,
          bundleId: context.req.valid('param').bundleId,
          ...context.req.valid('json'),
        })
        return context.json({ bundle })
      } catch (error) {
        return groupMutationFailure(context, error)
      }
    },
  )
  .post(
    '/permission-profile-preview',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
    zValidator('json', permissionProfilePreviewSchema),
    async (context) => {
      try {
        return context.json(await previewEnabledPermissionProfile(context.req.valid('json')))
      } catch (error) {
        if (!(error instanceof OrganizationPermissionCatalogError)) {
          throw error
        }
        return context.json(
          { code: 'PERMISSION_PROFILE_UNAVAILABLE', message: 'Permission profile is unavailable.' },
          404,
        )
      }
    },
  )
  .post(
    '/groups',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
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
    requireFreshOrganizationManager,
    zValidator('param', groupParamsSchema),
    zValidator('json', assignGroupSchema),
    async (context) => {
      try {
        const body = context.req.valid('json')
        const assignment = await assignOrganizationGroup({
          actorUserId: context.var.session!.userId,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          groupId: context.req.valid('param').groupId,
          reason: body.reason,
          targetUserId: body.userId,
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
    requireFreshOrganizationManager,
    zValidator('param', assignmentParamsSchema),
    zValidator('json', revokeSchema),
    async (context) => {
      try {
        const assignment = await revokeOrganizationGroupAssignment({
          actorUserId: context.var.session!.userId,
          assignmentId: context.req.valid('param').assignmentId,
          groupId: context.req.valid('param').groupId,
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
    requireFreshOrganizationManager,
    zValidator('param', memberParamsSchema),
    zValidator('json', revokeSchema),
    async (context) => {
      try {
        const block = await blockOrganizationMember({
          actorUserId: context.var.session!.userId,
          reason: context.req.valid('json').reason,
          targetUserId: context.req.valid('param').userId,
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
    requireFreshOrganizationManager,
    zValidator('param', memberParamsSchema),
    zValidator('json', revokeSchema),
    async (context) => {
      try {
        const block = await unblockOrganizationMember({
          actorUserId: context.var.session!.userId,
          reason: context.req.valid('json').reason,
          targetUserId: context.req.valid('param').userId,
        })
        return context.json({ block })
      } catch (error) {
        return memberBlockMutationFailure(context, error)
      }
    },
  )

function groupMutationFailure(context: Context, error: unknown) {
  if (!(error instanceof OrganizationGroupMutationError)) {
    throw error
  }
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
    case 'permission-unavailable':
      return context.json(
        {
          code: 'MODULE_PERMISSION_UNAVAILABLE',
          message: 'A selected module permission is unavailable.',
        },
        409,
      )
    case 'retained-permission-invalid':
      return context.json(
        {
          code: 'RETAINED_PERMISSION_INVALID',
          message: 'A retained permission entry is invalid or no longer unavailable.',
        },
        409,
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
  if (!(error instanceof OrganizationMemberBlockMutationError)) {
    throw error
  }
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
  if (!(error instanceof OrganizationCorporationSourceMutationError)) {
    throw error
  }
  switch (error.code) {
    case 'manager-authority-required':
      return context.json(
        { code: 'ORGANIZATION_MANAGER_REQUIRED', message: 'Organization management is required.' },
        403,
      )
    case 'manager-authority-degraded':
      return context.json(
        {
          code: 'ORGANIZATION_AUTHORITY_DEGRADED',
          message: 'Fresh organization authority is required for this operation.',
        },
        409,
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
    case 'source-character-affiliation-stale':
      return context.json(
        {
          code: 'CORPORATION_SOURCE_AFFILIATION_STALE',
          message: 'The selected character affiliation is stale. Try again after it is refreshed.',
        },
        409,
      )
  }
}
