import {
  isPlatformReviewerAccountSearchCursor,
  isPlatformReviewerAccountSearchQuery,
  type PlatformModuleRouteCapabilities,
  type PlatformReviewerSearchRouteEnv,
  type PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'

const searchQuery = z.object({
  query: z.string().trim().refine(isPlatformReviewerAccountSearchQuery).optional(),
  corporationId: z.coerce.number().int().positive().optional(),
  complianceState: z.enum(['pending', 'compliant', 'review_required', 'suspended']).optional(),
  blocked: z.stringbool().optional(),
  cursor: z.string().refine(isPlatformReviewerAccountSearchCursor).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
})

export function memberSearchRoutes(_capabilities: PlatformModuleRouteCapabilities) {
  return new Hono<PlatformReviewerSearchRouteEnv>().get(
    '/',
    zValidator('query', searchQuery),
    async (context) =>
      context.json(
        await context.var.platform.reviewerSearch.search(context.req.valid('query')),
        200,
      ),
  )
}

export function memberSummaryRoutes(_capabilities: PlatformModuleRouteCapabilities) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const target = context.var.platform.reviewerTarget
    return context.json(
      {
        organizationVersion: target.organizationVersion,
        managedMemberLifecycleId: target.managedMemberLifecycleId,
        account: target.account,
        characters: target.characters,
        compliance: target.compliance,
        groups: target.groups,
        block: target.block,
      },
      200,
    )
  })
}
