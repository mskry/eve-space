import { PiniaColadaQueryHooksPlugin, type PiniaColadaOptions, type QueryMeta } from '@pinia/colada'
import { PiniaColadaRetry } from '@pinia/colada-plugin-retry'
import { ApiQueryError } from './query-error'

export const QUERY_GC_TIME = 5 * 60_000
export const QUERY_ERROR_EVENT = 'eve-space:query-error'

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false
  if (error instanceof ApiQueryError) return error.status >= 500
  return error instanceof TypeError
}

export function queryRetryDelay(attempt: number) {
  return Math.min(500 * 2 ** attempt, 5_000)
}

export function reportQueryError(meta: QueryMeta) {
  if (
    !meta.globalErrorMessage ||
    typeof globalThis.dispatchEvent !== 'function' ||
    typeof CustomEvent === 'undefined'
  ) {
    return
  }
  globalThis.dispatchEvent(
    new CustomEvent(QUERY_ERROR_EVENT, { detail: { message: meta.globalErrorMessage } }),
  )
}

export const coladaOptions: PiniaColadaOptions = {
  queryOptions: {
    gcTime: QUERY_GC_TIME,
    staleTime: 15_000,
  },
  plugins: [
    PiniaColadaRetry({
      retry: shouldRetryQuery,
      delay: queryRetryDelay,
    }),
    PiniaColadaQueryHooksPlugin({
      onError(_error, entry) {
        reportQueryError(entry.meta)
      },
    }),
  ],
}
