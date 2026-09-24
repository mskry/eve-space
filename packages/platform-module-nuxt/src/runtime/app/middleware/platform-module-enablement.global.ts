import { abortNavigation, createError, defineNuxtRouteMiddleware, useRuntimeConfig } from '#imports'
import { effectScope } from 'vue'
import {
  loadPlatformModuleRuntimeState,
  usePlatformModuleRuntime,
} from '../composables/usePlatformModuleRuntime.js'

export default defineNuxtRouteMiddleware(async (to) => {
  const moduleId = to.meta.platformModuleId
  if (typeof moduleId !== 'string') {
    return
  }
  const sectionId = to.meta.platformModuleSectionId

  if (globalThis.window === undefined) {
    let enabledModuleIds: readonly string[]
    let enabledSectionKeys: ReadonlySet<string>
    try {
      const runtimeState = await loadPlatformModuleRuntimeState(useRuntimeConfig().public.apiBase)
      enabledModuleIds = runtimeState.enabledModuleIds
      enabledSectionKeys = new Set(
        runtimeState.enabledSections.map((section) => `${section.moduleId}/${section.sectionId}`),
      )
    } catch {
      return abortNavigation(
        createError({ statusCode: 503, statusMessage: 'Module state unavailable' }),
      )
    }
    if (!enabledModuleIds.includes(moduleId)) {
      return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page not found' }))
    }
    if (typeof sectionId === 'string' && !enabledSectionKeys.has(`${moduleId}/${sectionId}`)) {
      return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page not found' }))
    }
    return
  }

  const scope = effectScope()
  try {
    const { enabledModuleIds, enabledSectionKeys, ensureRuntimeState } =
      scope.run(usePlatformModuleRuntime)!
    try {
      await ensureRuntimeState()
    } catch {
      return abortNavigation(
        createError({ statusCode: 503, statusMessage: 'Module state unavailable' }),
      )
    }
    if (!enabledModuleIds.value.has(moduleId)) {
      return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page not found' }))
    }
    if (
      typeof sectionId === 'string' &&
      !enabledSectionKeys.value.has(`${moduleId}/${sectionId}`)
    ) {
      return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page not found' }))
    }
  } finally {
    scope.stop()
  }
})
