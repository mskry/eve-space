import { abortNavigation, createError, defineNuxtRouteMiddleware, useRuntimeConfig } from '#imports'
import {
  loadPlatformModuleRuntimeState,
  usePlatformModuleRuntime,
} from '../composables/usePlatformModuleRuntime.js'

export default defineNuxtRouteMiddleware(async (to) => {
  const moduleId = to.meta.platformModuleId
  if (typeof moduleId !== 'string') return

  if (typeof window === 'undefined') {
    let enabledModuleIds: readonly string[]
    try {
      const runtimeState = await loadPlatformModuleRuntimeState(useRuntimeConfig().public.apiBase)
      enabledModuleIds = runtimeState.enabledModuleIds
    } catch {
      return abortNavigation(
        createError({ statusCode: 503, statusMessage: 'Module state unavailable' }),
      )
    }
    if (!enabledModuleIds.includes(moduleId))
      return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page not found' }))
    return
  }

  const { enabledModuleIds, ensureRuntimeState } = usePlatformModuleRuntime()
  try {
    await ensureRuntimeState()
  } catch {
    return abortNavigation(
      createError({ statusCode: 503, statusMessage: 'Module state unavailable' }),
    )
  }
  if (!enabledModuleIds.value.has(moduleId))
    return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page not found' }))
})
