import { shallowRef, computed } from 'vue'
import { ApiQueryError } from './query-error.js'

export type PlatformInventorySelection =
  | { readonly scope: 'personal'; readonly characterIds?: readonly number[] }
  | { readonly scope: 'corporation'; readonly corporationId: number }

export interface PlatformInventoryAdmission {
  readonly ownerId: string
  readonly fingerprint: string
  readonly validForMilliseconds: number
}

type InventoryQueryStatus =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'unavailable'
  | 'denied'
  | 'loading'
  | 'error'

const knownDenial = (error: Error) => {
  if (!(error instanceof ApiQueryError)) return false
  const status = error.status
  return status === 401 || status === 403 || status === 404 || status === 409
}
const knownLimit = (error: Error) =>
  error instanceof ApiQueryError &&
  (error.code === 'INVENTORY_LIMIT' || error.code === 'OPERATION_LIMIT' || error.status === 400)

export const createPlatformInventoryQuery = <Result>(dependencies: {
  readonly admit: (signal: AbortSignal) => Promise<PlatformInventoryAdmission>
  readonly ownerId: () => string | null
}) => {
  const status = shallowRef<InventoryQueryStatus>('idle')
  const retained = shallowRef<Result>()
  const error = shallowRef<Error>()
  let admission: PlatformInventoryAdmission | undefined
  let generation = 0
  let active = new AbortController()
  let expiry: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    generation += 1
    active.abort()
    active = new AbortController()
    clearTimeout(expiry)
  }
  const invalidate = (reason?: Error) => {
    cancel()
    admission = undefined
    retained.value = undefined
    error.value = reason
    status.value = reason ? 'denied' : 'idle'
  }
  const suspend = () => {
    cancel()
    status.value = 'unavailable'
  }
  const check = async () => {
    cancel()
    const current = generation
    status.value = 'checking'
    error.value = undefined
    try {
      const verdict = await dependencies.admit(active.signal)
      if (current !== generation) return false
      if (
        !verdict.ownerId ||
        !/^[\da-f]{64}$/.test(verdict.fingerprint) ||
        !Number.isFinite(verdict.validForMilliseconds) ||
        verdict.validForMilliseconds <= 0
      )
        throw new Error('Inventory admission is unavailable.')
      if (verdict.ownerId !== dependencies.ownerId()) {
        invalidate()
        status.value = 'denied'
        return false
      }
      if (admission && admission.fingerprint !== verdict.fingerprint) retained.value = undefined
      admission = verdict
      status.value = 'ready'
      expiry = setTimeout(suspend, Math.min(60_000, verdict.validForMilliseconds))
      return true
    } catch (error_) {
      if (current !== generation) return false
      const problem =
        error_ instanceof Error ? error_ : new Error('Inventory verification unavailable.')
      if (knownDenial(problem)) {
        admission = undefined
        retained.value = undefined
        status.value = 'denied'
      } else if (knownLimit(problem)) {
        retained.value = undefined
        status.value = 'error'
      } else status.value = 'unavailable'
      error.value = problem
      return false
    }
  }
  const run = async (load: (signal: AbortSignal) => Promise<Result>) => {
    if (status.value !== 'ready' || !admission) return
    const current = generation
    status.value = 'loading'
    try {
      const value = await load(active.signal)
      if (current !== generation || active.signal.aborted) return
      retained.value = value
      error.value = undefined
      status.value = 'ready'
    } catch (error_) {
      if (current !== generation || active.signal.aborted) return
      error.value = error_ instanceof Error ? error_ : new Error('Inventory read unavailable.')
      if (knownDenial(error.value)) {
        retained.value = undefined
        status.value = 'denied'
      } else if (knownLimit(error.value)) {
        retained.value = undefined
        status.value = 'error'
      } else status.value = 'unavailable'
    }
  }
  return {
    status,
    error,
    data: computed(() =>
      status.value === 'ready' || status.value === 'loading' ? retained.value : undefined,
    ),
    check,
    run,
    invalidate,
    suspend,
    dispose: invalidate,
  }
}
