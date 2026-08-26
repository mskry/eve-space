import type { MiddlewareHandler } from 'hono'
import { routeNotFoundBody } from '../http-contracts.js'
import { isInstalledModuleEnabled } from '../platform/module-settings.js'

export function requireInstalledModuleEnabled(moduleId: string): MiddlewareHandler {
  return async (context, next) => {
    if (!(await isInstalledModuleEnabled(moduleId))) return context.json(routeNotFoundBody, 404)
    await next()
  }
}
