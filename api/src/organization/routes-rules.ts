import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { zValidator } from '../http/validation.js'
import type { OrganizationSessionEnv } from '../middleware/organization-session.js'
import { reviewedCorporationRolePredicates } from '../characters/corporation-role-canonical.js'
import { organizationAuditReasonSchema } from './audit.js'
import { OrganizationGroupMutationError } from './group-mutation-error.js'
import {
  createOrganizationGroupRule,
  disableOrganizationGroupRule,
  getOrganizationRuleMemberSummary,
  listOrganizationRuleAuditPermissions,
  listOrganizationGroupRules,
  organizationRuleConditionCatalog,
  previewOrganizationGroupRule,
  reviseOrganizationGroupRule,
} from './group-rule-store.js'
import { requireFreshOrganizationOwner, requireTrustedOrigin } from './route-middleware.js'

const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('registration-compliant') }).strict(),
  z.object({ kind: z.literal('director-audience') }).strict(),
  z
    .object({
      kind: z.literal('corporation-role'),
      predicate: z.enum(reviewedCorporationRolePredicates),
    })
    .strict(),
])
const bundleIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(50)
  .refine((bundleIds) => new Set(bundleIds).size === bundleIds.length)
const createRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    bundleIds: bundleIdsSchema,
    condition: conditionSchema,
    enabled: z.boolean(),
    reason: organizationAuditReasonSchema,
  })
  .strict()
const previewSchema = z
  .object({
    bundleIds: bundleIdsSchema,
    condition: conditionSchema,
    targetUserId: z.uuid(),
    permissionOffset: z.number().int().nonnegative().max(10_000).optional(),
  })
  .strict()
const updateSchema = createRuleSchema
  .omit({ name: true })
  .extend({
    expectedRevision: z.number().int().positive(),
  })
  .strict()
const disableSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    reason: organizationAuditReasonSchema,
  })
  .strict()
const groupIdSchema = z.object({ groupId: z.uuid() })
const memberParamsSchema = z.object({ groupId: z.uuid(), userId: z.uuid() })
const memberQuerySchema = z.object({
  permissionOffset: z.coerce.number().int().nonnegative().max(10_000).optional(),
})
const auditParamsSchema = z.object({ auditId: z.uuid() })
const auditQuerySchema = z.object({ afterPermissionId: z.uuid().optional() })

export const organizationRuleRoutes = new Hono<OrganizationSessionEnv>()
  .get('/group-rules/conditions', requireFreshOrganizationOwner, (context) =>
    context.json(organizationRuleConditionCatalog()),
  )
  .get('/group-rules', requireFreshOrganizationOwner, async (context) => {
    try {
      return context.json(await listOrganizationGroupRules(context.var.session!.userId))
    } catch (error) {
      return ruleMutationFailure(
        context,
        error instanceof Error ? error : new Error('Unexpected rule failure'),
      )
    }
  })
  .get(
    '/group-rules/audit/:auditId/permissions',
    requireFreshOrganizationOwner,
    zValidator('param', auditParamsSchema),
    zValidator('query', auditQuerySchema),
    async (context) => {
      try {
        return context.json(
          await listOrganizationRuleAuditPermissions({
            actorUserId: context.var.session!.userId,
            auditId: context.req.valid('param').auditId,
            ...context.req.valid('query'),
          }),
        )
      } catch (error) {
        return ruleMutationFailure(
          context,
          error instanceof Error ? error : new Error('Unexpected rule failure'),
        )
      }
    },
  )
  .get(
    '/group-rules/:groupId/members/:userId',
    requireFreshOrganizationOwner,
    zValidator('param', memberParamsSchema),
    zValidator('query', memberQuerySchema),
    async (context) => {
      try {
        return context.json(
          await getOrganizationRuleMemberSummary({
            actorUserId: context.var.session!.userId,
            ...context.req.valid('param'),
            ...context.req.valid('query'),
          }),
        )
      } catch (error) {
        return ruleMutationFailure(
          context,
          error instanceof Error ? error : new Error('Unexpected rule failure'),
        )
      }
    },
  )
  .post(
    '/group-rules/preview',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
    zValidator('json', previewSchema),
    async (context) => {
      try {
        return context.json(
          await previewOrganizationGroupRule({
            actorUserId: context.var.session!.userId,
            ...context.req.valid('json'),
          }),
        )
      } catch (error) {
        return ruleMutationFailure(
          context,
          error instanceof Error ? error : new Error('Unexpected rule failure'),
        )
      }
    },
  )
  .post(
    '/group-rules',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
    zValidator('json', createRuleSchema),
    async (context) => {
      try {
        const rule = await createOrganizationGroupRule({
          actorUserId: context.var.session!.userId,
          ...context.req.valid('json'),
        })
        return context.json({ rule }, 201)
      } catch (error) {
        return ruleMutationFailure(
          context,
          error instanceof Error ? error : new Error('Unexpected rule failure'),
        )
      }
    },
  )
  .put(
    '/group-rules/:groupId',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
    zValidator('param', groupIdSchema),
    zValidator('json', updateSchema),
    async (context) => {
      try {
        const rule = await reviseOrganizationGroupRule({
          actorUserId: context.var.session!.userId,
          groupId: context.req.valid('param').groupId,
          ...context.req.valid('json'),
        })
        return context.json({ rule })
      } catch (error) {
        return ruleMutationFailure(
          context,
          error instanceof Error ? error : new Error('Unexpected rule failure'),
        )
      }
    },
  )
  .post(
    '/group-rules/:groupId/disable',
    requireTrustedOrigin,
    requireFreshOrganizationOwner,
    zValidator('param', groupIdSchema),
    zValidator('json', disableSchema),
    async (context) => {
      try {
        const rule = await disableOrganizationGroupRule({
          actorUserId: context.var.session!.userId,
          groupId: context.req.valid('param').groupId,
          ...context.req.valid('json'),
        })
        return context.json({ rule })
      } catch (error) {
        return ruleMutationFailure(
          context,
          error instanceof Error ? error : new Error('Unexpected rule failure'),
        )
      }
    },
  )

const ruleMutationFailure = (context: Context, error: Error) => {
  if (!(error instanceof OrganizationGroupMutationError)) {
    throw error
  }
  if (error.code === 'owner-authority-required') {
    return context.json(
      { code: 'ORGANIZATION_OWNER_REQUIRED', message: 'Current owner authority is required.' },
      403,
    )
  }
  if (
    error.code === 'target-not-found' ||
    error.code === 'rule-not-found' ||
    error.code === 'bundle-not-found'
  ) {
    return context.json(
      { code: 'RULE_RESOURCE_NOT_FOUND', message: 'Rule resource is unavailable.' },
      404,
    )
  }
  if (error.code === 'group-name-conflict' || error.code === 'rule-revision-conflict') {
    return context.json(
      { code: 'RULE_CONFLICT', message: 'The rule changed; refresh and retry.' },
      409,
    )
  }
  return context.json(
    { code: 'INVALID_RULE_CONDITION', message: 'Rule condition is invalid.' },
    400,
  )
}
