import { abortNavigation, createError, defineNuxtRouteMiddleware } from '#imports'
import { usePlatformModuleRuntime } from '../composables/usePlatformModuleRuntime.js'

export default defineNuxtRouteMiddleware(async (to) => {
  if (typeof window === 'undefined') return
  const moduleId = to.meta.platformModuleId
  if (typeof moduleId !== 'string') return

  const { enabledModuleIds, ensureRuntimeState } = usePlatformModuleRuntime()
  try {
    await ensureRuntimeState()
  } catch {
    return
  }
  if (!enabledModuleIds.value.has(moduleId))
    return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page not found' }))
})
