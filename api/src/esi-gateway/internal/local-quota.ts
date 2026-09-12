import type { EsiOperation } from './catalog.js'
import { getDeclaredEsiRateLimit } from './catalog-access.js'
import { esiOperationCatalog } from './catalog.js'
import type {
  EsiRequestPermit,
  RuntimeLocalQuotaStatePort,
  RuntimeTimingPort,
} from './runtime-ports.js'
import { wait } from './timing.js'

const concurrencyLeaseTtlMs = 30_000
const permitPollMs = 50
const maximumLocalCooldowns = 1_000
const processLocalQuotaState: RuntimeLocalQuotaStatePort = {
  operationCooldowns: new Map(),
  groupCooldowns: new Map(),
  inFlight: new Map(),
  globalCooldownUntil: 0,
}
const systemTiming: Pick<RuntimeTimingPort, 'now' | 'wait'> = { now: () => Date.now(), wait }

export type LocalEsiPermitResult =
  | { readonly kind: 'acquired'; readonly permit: EsiRequestPermit }
  | { readonly kind: 'cooldown' | 'timeout'; readonly retryAfterSeconds: number }

export function getLocalEsiCooldownUntil(
  operation: EsiOperation,
  principal: string,
  now: number,
  state: RuntimeLocalQuotaStatePort = processLocalQuotaState,
) {
  pruneLocalCooldowns(state, now)
  const group = getDeclaredEsiRateGroup(operation)
  return Math.max(
    state.globalCooldownUntil,
    state.operationCooldowns.get(`${operation}:${principal}`) ?? 0,
    group ? (state.groupCooldowns.get(`${group}:${principal}`) ?? 0) : 0,
  )
}

export function recordLocalEsiCooldowns(options: {
  operation: EsiOperation
  principal: string
  globalRetryAt?: number
  operationRetryAt?: number
  state?: RuntimeLocalQuotaStatePort
  now?: number
}) {
  const state = options.state ?? processLocalQuotaState
  const now = options.now ?? Date.now()
  pruneLocalCooldowns(state, now)
  if (options.globalRetryAt !== undefined)
    state.globalCooldownUntil = Math.max(state.globalCooldownUntil, options.globalRetryAt)
  if (options.operationRetryAt === undefined) return

  const identity = `${options.operation}:${options.principal}`
  state.operationCooldowns.set(
    identity,
    Math.max(state.operationCooldowns.get(identity) ?? 0, options.operationRetryAt),
  )
  const group = getDeclaredEsiRateGroup(options.operation)
  if (group) {
    const key = `${group}:${options.principal}`
    state.groupCooldowns.set(
      key,
      Math.max(state.groupCooldowns.get(key) ?? 0, options.operationRetryAt),
    )
  }
  boundLocalCooldowns(state.operationCooldowns)
  boundLocalCooldowns(state.groupCooldowns)
}

export async function acquireLocalEsiRequestPermit(options: {
  operation: EsiOperation
  principal: string
  sharedConcurrency: number
  deadline: number
  signal?: AbortSignal
  state?: RuntimeLocalQuotaStatePort
  timing?: Pick<RuntimeTimingPort, 'now' | 'wait'>
}): Promise<LocalEsiPermitResult> {
  options.signal?.throwIfAborted()
  const state = options.state ?? processLocalQuotaState
  const timing = options.timing ?? systemTiming
  const limit = Math.max(1, Math.floor(options.sharedConcurrency / 2))
  while (timing.now() < options.deadline) {
    const now = timing.now()
    const cooldownUntil = getLocalEsiCooldownUntil(options.operation, options.principal, now, state)
    if (cooldownUntil > now)
      return {
        kind: 'cooldown',
        retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntil - now) / 1_000)),
      }
    const count = state.inFlight.get(options.operation) ?? 0
    if (count < limit) {
      state.inFlight.set(options.operation, count + 1)
      return {
        kind: 'acquired',
        permit: {
          coordinationAvailable: false,
          ttlMs: concurrencyLeaseTtlMs,
          renew: async () => true,
          async release() {
            const current = state.inFlight.get(options.operation) ?? 0
            if (current <= 1) state.inFlight.delete(options.operation)
            else state.inFlight.set(options.operation, current - 1)
          },
        },
      }
    }
    // oxlint-disable-next-line no-await-in-loop
    await timing.wait(
      Math.min(permitPollMs, Math.max(1, options.deadline - timing.now())),
      options.signal,
    )
  }
  return { kind: 'timeout', retryAfterSeconds: 1 }
}

function pruneLocalCooldowns(state: RuntimeLocalQuotaStatePort, now: number) {
  if (state.globalCooldownUntil <= now) state.globalCooldownUntil = 0
  for (const [key, retryAt] of state.operationCooldowns) {
    if (retryAt <= now) state.operationCooldowns.delete(key)
  }
  for (const [key, retryAt] of state.groupCooldowns) {
    if (retryAt <= now) state.groupCooldowns.delete(key)
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
