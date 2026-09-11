import type { EsiOperation } from './catalog.js'
import { getDeclaredEsiRateLimit } from './catalog-access.js'
import { esiOperationCatalog } from './catalog.js'
import type { EsiRequestPermit } from './permits.js'
import { wait } from './timing.js'

const concurrencyLeaseTtlMs = 30_000
const permitPollMs = 50
const maximumLocalCooldowns = 1_000
const localOperationCooldowns = new Map<string, number>()
const localGroupCooldowns = new Map<string, number>()
const localInFlight = new Map<string, number>()
let localGlobalCooldownUntil = 0

export type LocalEsiPermitResult =
  | { readonly kind: 'acquired'; readonly permit: EsiRequestPermit }
  | { readonly kind: 'cooldown' | 'timeout'; readonly retryAfterSeconds: number }

export function getLocalEsiCooldownUntil(operation: EsiOperation, principal: string, now: number) {
  pruneLocalCooldowns(now)
  const group = getDeclaredEsiRateGroup(operation)
  return Math.max(
    localGlobalCooldownUntil,
    localOperationCooldowns.get(`${operation}:${principal}`) ?? 0,
    group ? (localGroupCooldowns.get(`${group}:${principal}`) ?? 0) : 0,
  )
}

export function recordLocalEsiCooldowns(options: {
  operation: EsiOperation
  principal: string
  globalRetryAt?: number
  operationRetryAt?: number
}) {
  const now = Date.now()
  pruneLocalCooldowns(now)
  if (options.globalRetryAt !== undefined)
    localGlobalCooldownUntil = Math.max(localGlobalCooldownUntil, options.globalRetryAt)
  if (options.operationRetryAt === undefined) return

  const identity = `${options.operation}:${options.principal}`
  localOperationCooldowns.set(
    identity,
    Math.max(localOperationCooldowns.get(identity) ?? 0, options.operationRetryAt),
  )
  const group = getDeclaredEsiRateGroup(options.operation)
  if (group) {
    const key = `${group}:${options.principal}`
    localGroupCooldowns.set(
      key,
      Math.max(localGroupCooldowns.get(key) ?? 0, options.operationRetryAt),
    )
  }
  boundLocalCooldowns(localOperationCooldowns)
  boundLocalCooldowns(localGroupCooldowns)
}

export async function acquireLocalEsiRequestPermit(options: {
  operation: EsiOperation
  principal: string
  sharedConcurrency: number
  deadline: number
  signal?: AbortSignal
}): Promise<LocalEsiPermitResult> {
  options.signal?.throwIfAborted()
  const limit = Math.max(1, Math.floor(options.sharedConcurrency / 2))
  while (Date.now() < options.deadline) {
    const now = Date.now()
    const cooldownUntil = getLocalEsiCooldownUntil(options.operation, options.principal, now)
    if (cooldownUntil > now)
      return {
        kind: 'cooldown',
        retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntil - now) / 1_000)),
      }
    const count = localInFlight.get(options.operation) ?? 0
    if (count < limit) {
      localInFlight.set(options.operation, count + 1)
      return {
        kind: 'acquired',
        permit: {
          coordinationAvailable: false,
          ttlMs: concurrencyLeaseTtlMs,
          renew: async () => true,
          async release() {
            const current = localInFlight.get(options.operation) ?? 0
            if (current <= 1) localInFlight.delete(options.operation)
            else localInFlight.set(options.operation, current - 1)
          },
        },
      }
    }
    // oxlint-disable-next-line no-await-in-loop
    await wait(Math.min(permitPollMs, Math.max(1, options.deadline - Date.now())), options.signal)
  }
  return { kind: 'timeout', retryAfterSeconds: 1 }
}

function pruneLocalCooldowns(now: number) {
  if (localGlobalCooldownUntil <= now) localGlobalCooldownUntil = 0
  for (const [key, retryAt] of localOperationCooldowns) {
    if (retryAt <= now) localOperationCooldowns.delete(key)
  }
  for (const [key, retryAt] of localGroupCooldowns) {
    if (retryAt <= now) localGroupCooldowns.delete(key)
  }
}

function boundLocalCooldowns(cooldowns: Map<string, number>) {
  while (cooldowns.size > maximumLocalCooldowns) {
    const oldest = cooldowns.keys().next().value
    if (oldest === undefined) return
    cooldowns.delete(oldest)
  }
}

function getDeclaredEsiRateGroup(operation: EsiOperation) {
  return getDeclaredEsiRateLimit(esiOperationCatalog[operation])?.group
}
