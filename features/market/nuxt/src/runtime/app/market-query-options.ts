import type { QueryCache } from '@pinia/colada'
import { defineNonPersistentQueryOptions } from '@eve-space/platform-module-nuxt/runtime'
import { marketGraphQLIdentity } from './market-graphql'

export const marketGraphQLKey = (
  operation: string,
  selectors: readonly (string | number | null)[],
) => ['market', 'graphql', ...marketGraphQLIdentity, operation, ...selectors]

export const marketQueryOptions = <Result>(
  key: ReturnType<typeof marketGraphQLKey>,
  enabled: boolean,
  staleTime: number,
  query: ({ signal }: { signal: AbortSignal }) => Promise<Result>,
) =>
  defineNonPersistentQueryOptions(() => ({
    key,
    enabled,
    staleTime,
    gcTime: 300_000,
    retry: 0,
    esiPersistence: { kind: 'none' },
    query,
  }))(undefined)

export const marketRelease = (
  signal: AbortSignal,
  captured: readonly unknown[],
  current: readonly unknown[],
) => {
  signal.throwIfAborted()
  if (JSON.stringify(captured) !== JSON.stringify(current))
    throw new Error('Market selection changed.')
}

export const marketSourceStaleTime = (
  queryCache: QueryCache,
  key: ReturnType<typeof marketGraphQLKey>,
  maximum: number,
  freshUntil?: string | null,
) => {
  if (!freshUntil) return maximum
  const successAt = queryCache.get(key)?.when ?? Date.now()
  const expiry = Date.parse(freshUntil)
  return Number.isFinite(expiry) ? Math.max(0, Math.min(maximum, expiry - successAt)) : 0
}
