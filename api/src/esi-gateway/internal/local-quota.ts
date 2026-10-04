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
const maximumLocalCooldowns = 1000
const processLocalQuotaState: RuntimeLocalQuotaStatePort = {
  globalCooldownUntil: 0,
  groupCooldowns: new Map(),
  pacing: new Map(),
  pacingOverflowUntil: 0,
  inFlight: new Map(),
  operationCooldowns: new Map(),
}
const systemTiming: Pick<RuntimeTimingPort, 'now' | 'wait'> = { now: () => Date.now(), wait }

export type LocalEsiPermitResult =
  | { readonly kind: 'acquired'; readonly permit: EsiRequestPermit }
  | { readonly kind: 'cooldown' | 'timeout'; readonly retryAfterSeconds: number }

export interface EsiPacingPolicy {
  readonly group: string
  readonly maximumTokens: number
  readonly windowMs: number
  readonly margin: number
  readonly intervalMs: number
}

export const getEsiPacingPolicy = (
  operation: EsiOperation,
  concurrency: number,
): EsiPacingPolicy | undefined => {
  const declaration = getDeclaredEsiRateLimit(esiOperationCatalog[operation])
  if (!declaration) {
    return undefined
  }
  const windowMs = getWindowMilliseconds(declaration.window)
  const maximumTokens = declaration.maximumTokens
  return {
    group: declaration.group,
    maximumTokens,
    windowMs,
    margin: Math.min(maximumTokens, Math.max(Math.ceil(maximumTokens / 10), 5 * concurrency)),
    intervalMs: Math.min(60_000, Math.max(1000, (5 * windowMs) / maximumTokens)),
  }
}

export const getEsiMinimumStartPolicy = (operation: EsiOperation) => {
  const operationId = esiOperationCatalog[operation].audit.esiOperationId
  return operationId === 'GetMarketsRegionIdHistory'
    ? ({ operationId, intervalMs: 1_000 } as const)
    : undefined
}

const getWindowMilliseconds = (window: string): number => {
  const multipliers = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }
  const unit = window.at(-1)
  if (unit !== 's' && unit !== 'm' && unit !== 'h' && unit !== 'd') {
    throw new Error('Invalid declared ESI rate window')
  }
  return Number(window.slice(0, -1)) * multipliers[unit]
}

const pacingIdentity = (group: string, principal: string) => `${group}:${principal}`

export const getLocalEsiPacing = (
  group: string,
  principal: string,
  now: number,
  state: RuntimeLocalQuotaStatePort = processLocalQuotaState,
) => {
  pruneLocalPacing(state, now)
  return (
    state.pacing.get(pacingIdentity(group, principal)) ??
    (state.pacingOverflowUntil > now
      ? {
          nextAt: state.pacingOverflowUntil,
          expiresAt: state.pacingOverflowUntil,
          intervalMs: 60_000,
        }
      : undefined)
  )
}

export const recordLocalEsiPacing = (
  policy: EsiPacingPolicy,
  principal: string,
  remaining: number,
  now: number,
  state: RuntimeLocalQuotaStatePort = processLocalQuotaState,
) => {
  const current = getLocalEsiPacing(policy.group, principal, now, state)
  if (remaining > policy.margin) {
    return
  }
  const intervalMs = remaining < 5 ? 60_000 : policy.intervalMs
  const key = pacingIdentity(policy.group, principal)
  state.pacing.delete(key)
  state.pacing.set(key, {
    nextAt: Math.max(current?.nextAt ?? 0, now + intervalMs),
    expiresAt: Math.max(current?.expiresAt ?? 0, now + policy.windowMs),
    intervalMs: Math.max(current?.intervalMs ?? 0, intervalMs),
  })
  while (state.pacing.size > maximumLocalCooldowns) {
    const oldest = state.pacing.keys().next().value
    if (oldest === undefined) break
    state.pacingOverflowUntil = Math.max(
      state.pacingOverflowUntil,
      state.pacing.get(oldest)!.expiresAt,
    )
    state.pacing.delete(oldest)
  }
}

export const advanceLocalEsiPacing = (
  group: string,
  principal: string,
  now: number,
  state?: RuntimeLocalQuotaStatePort,
) => {
  const pacing = getLocalEsiPacing(group, principal, now, state)
  if (pacing) {
    pacing.nextAt = Math.max(pacing.nextAt, now + pacing.intervalMs)
  }
}

const pruneLocalPacing = (state: RuntimeLocalQuotaStatePort, now: number) => {
  if (state.pacingOverflowUntil <= now) state.pacingOverflowUntil = 0
  for (const [key, entry] of state.pacing) {
    if (entry.expiresAt <= now) {
      state.pacing.delete(key)
    }
  }
}

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
  if (options.globalRetryAt !== undefined) {
    state.globalCooldownUntil = Math.max(state.globalCooldownUntil, options.globalRetryAt)
  }
  if (options.operationRetryAt === undefined) {
    return
  }

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
    const policy = getEsiPacingPolicy(options.operation, options.sharedConcurrency)
    const pacing = policy && getLocalEsiPacing(policy.group, options.principal, now, state)
    const retryAt = Math.max(
      getLocalEsiCooldownUntil(options.operation, options.principal, now, state),
      pacing?.nextAt ?? 0,
    )
    if (retryAt > now) {
      return {
        kind: 'cooldown',
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
      }
    }
    const count = state.inFlight.get(options.operation) ?? 0
    if (count < limit) {
      state.inFlight.set(options.operation, count + 1)
      if (pacing) {
        pacing.nextAt = now + pacing.intervalMs
      }
      return {
        kind: 'acquired',
        permit: {
          coordinationAvailable: false,
          async release() {
            const current = state.inFlight.get(options.operation) ?? 0
            if (current <= 1) {
              state.inFlight.delete(options.operation)
            } else {
              state.inFlight.set(options.operation, current - 1)
            }
          },
          renew: async () => true,
          ttlMs: concurrencyLeaseTtlMs,
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
  if (state.globalCooldownUntil <= now) {
    state.globalCooldownUntil = 0
  }
  for (const [key, retryAt] of state.operationCooldowns) {
    if (retryAt <= now) {
      state.operationCooldowns.delete(key)
    }
  }
  for (const [key, retryAt] of state.groupCooldowns) {
    if (retryAt <= now) {
      state.groupCooldowns.delete(key)
    }
  }
}

function boundLocalCooldowns<Value>(cooldowns: Map<string, Value>) {
  while (cooldowns.size > maximumLocalCooldowns) {
    const oldest = cooldowns.keys().next().value
    if (oldest === undefined) {
      return
    }
    cooldowns.delete(oldest)
  }
}

function getDeclaredEsiRateGroup(operation: EsiOperation) {
  return getDeclaredEsiRateLimit(esiOperationCatalog[operation])?.group
}
