import type { PlatformReviewerTargetContext } from '@eve-space/platform-module-contract/server'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { resolveOrganizationReviewerTarget } from '../organization/reviewer-target.js'
import type { ModuleOrganizationAuthorizationEnv } from './module-authorization.js'

const positiveCharacterId = z
  .string()
  .regex(/^[1-9]\d*$/, 'Character ID must be a positive integer.')
  .transform(Number)
  .pipe(z.number().int().positive('Character ID must be a positive integer.'))

export const reviewerAccountParams = z.object({ userId: z.uuid() })
export const reviewerCharacterParams = reviewerAccountParams.extend({
  characterId: positiveCharacterId,
})

export type OrganizationReviewerTargetEnv = {
  Variables: ModuleOrganizationAuthorizationEnv['Variables'] & {
    organizationReviewerTarget?: PlatformReviewerTargetContext | null
  }
}

export function loadOrganizationReviewerTarget(targetKind: 'account' | 'character' | null) {
  return createMiddleware<OrganizationReviewerTargetEnv>(async (context, next) => {
    if (targetKind === null) {
      context.set('organizationReviewerTarget', null)
      await next()
      return
    }
    const authorization = context.var.moduleOrganizationAuthorization!
    const binding = await resolveOrganizationReviewerTarget({
      organizationVersion: authorization.organizationVersion,
      targetUserId: context.req.param('userId')!,
      ...(targetKind === 'character'
        ? { characterId: Number(context.req.param('characterId')) }
        : {}),
    })
    if (!binding) {
      return context.json(
        { code: 'REVIEW_TARGET_NOT_FOUND', message: 'Review target not found.' },
        404,
      )
    }

    context.set('organizationReviewerTarget', binding)
    await next()
  })
}
