import { env } from '../env.js'

type EsiValueCache = 'shared' | 'none'

export interface EsiOperationPolicy {
  valueCache: EsiValueCache
  collapse: boolean
  revalidate: boolean
  validateResponses: boolean
  upstreamExpiryFallbackMs: number
  ttlJitterMs: number
  maximumStaleAgeMs: number
  maximumRetentionAgeMs: number
  allowStale: boolean
  concurrency: number
  retry: {
    attempts: number
    initialDelayMs: number
    maximumDelayMs: number
  }
}

const minute = 60_000
const hour = 60 * minute

const publicRead = {
  valueCache: 'shared',
  collapse: true,
  revalidate: true,
  validateResponses: true,
  upstreamExpiryFallbackMs: minute,
  ttlJitterMs: 5_000,
  maximumStaleAgeMs: hour,
  maximumRetentionAgeMs: hour,
  allowStale: true,
  concurrency: env.ESI_OPERATION_CONCURRENCY,
  retry: { attempts: 3, initialDelayMs: 500, maximumDelayMs: 10_000 },
} as const satisfies EsiOperationPolicy

const privateRead = {
  ...publicRead,
  maximumStaleAgeMs: 0,
  allowStale: false,
} as const satisfies EsiOperationPolicy

const noValueCache = {
  valueCache: 'none',
  collapse: false,
  revalidate: false,
  validateResponses: true,
  upstreamExpiryFallbackMs: minute,
  ttlJitterMs: 0,
  maximumStaleAgeMs: 0,
  maximumRetentionAgeMs: 0,
  allowStale: false,
  concurrency: env.ESI_OPERATION_CONCURRENCY,
  retry: { attempts: 3, initialDelayMs: 500, maximumDelayMs: 10_000 },
} as const satisfies EsiOperationPolicy

export const esiOperationPolicies = {
  status: publicRead,
  'public-character': publicRead,
  'public-corporation': publicRead,
  'public-alliance': publicRead,
  'universe-races': publicRead,
  'universe-bloodlines': { ...publicRead, validateResponses: false },
  'wallet-balance': privateRead,
  'wallet-transactions': privateRead,
  skills: privateRead,
  location: privateRead,
  ship: privateRead,
  'employment-history': publicRead,
  'universe-resolve-names': publicRead,
  'corporation-alliance-history': publicRead,
  'corporation-npc-list': publicRead,
  'universe-solar-system': publicRead,
  'universe-station': publicRead,
  'universe-type': publicRead,
  'bulk-affiliation': noValueCache,
} as const satisfies Record<string, EsiOperationPolicy>

export type EsiOperation = keyof typeof esiOperationPolicies

export function getEsiOperationPolicy(operation: EsiOperation) {
  return esiOperationPolicies[operation]
}

export function assertRegisteredEsiOperation(operation: string): asserts operation is EsiOperation {
  if (!(operation in esiOperationPolicies))
    throw new Error(`Unregistered ESI operation: ${operation}`)
}
