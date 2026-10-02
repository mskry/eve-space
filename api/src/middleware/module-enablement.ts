import type { MiddlewareHandler } from 'hono'
import { moduleReadEnablementDenial } from '../platform/read-enablement.js'

export const requireInstalledModuleEnabled = (
  moduleId: string,
  sectionId?: string,
): MiddlewareHandler => {
  return async (context, next) => {
    const denial = await moduleReadEnablementDenial(moduleId, sectionId)
    if (denial) return context.json(denial.body, denial.status)
    await next()
  }
}
