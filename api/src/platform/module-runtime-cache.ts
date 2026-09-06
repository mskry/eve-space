import type { ShellNavigationOrder } from './module-navigation.js'

export interface ModuleRuntimeState {
  readonly enabledModuleIds: readonly string[]
  readonly shellNavigationOrder: ShellNavigationOrder
}

let runtimeStateCache: { value: ModuleRuntimeState; expiresAt: number } | undefined
let runtimeStateLoad: { generation: number; promise: Promise<ModuleRuntimeState> } | undefined
let runtimeStateGeneration = 0

export async function loadCachedModuleRuntimeState(
  loadState: () => Promise<ModuleRuntimeState>,
  loadCacheTtlMs: () => Promise<number>,
): Promise<ModuleRuntimeState> {
  const now = Date.now()
  if (runtimeStateCache && runtimeStateCache.expiresAt > now) return runtimeStateCache.value

  const generation = runtimeStateGeneration
  const load = runtimeStateLoad ?? (runtimeStateLoad = { generation, promise: loadState() })

  let loaded: [ModuleRuntimeState, number]
  try {
    loaded = await Promise.all([load.promise, loadCacheTtlMs()])
  } catch (error) {
    if (runtimeStateLoad === load) runtimeStateLoad = undefined
    if (load.generation === runtimeStateGeneration) throw error
    return loadCachedModuleRuntimeState(loadState, loadCacheTtlMs)
  }

  if (runtimeStateLoad === load) runtimeStateLoad = undefined
  if (load.generation !== runtimeStateGeneration)
    return loadCachedModuleRuntimeState(loadState, loadCacheTtlMs)

  const [value, cacheTtlMs] = loaded
  runtimeStateCache = { value, expiresAt: Date.now() + cacheTtlMs }
  return value
}

export function invalidateModuleRuntimeState() {
  runtimeStateGeneration += 1
  runtimeStateCache = undefined
}
