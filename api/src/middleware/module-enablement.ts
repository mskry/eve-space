import type { MiddlewareHandler } from 'hono'
import { routeNotFoundBody } from '../http/contracts.js'
import { isInstalledModuleContributionEnabled } from '../platform/module-settings.js'

export function requireInstalledModuleEnabled(
  moduleId: string,
  sectionId?: string,
): MiddlewareHandler {
  return async (context, next) => {
    if (!(await isInstalledModuleContributionEnabled(moduleId, sectionId))) {
      return context.json(routeNotFoundBody, 404)
    }
    await next()
  }
}
