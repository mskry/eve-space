import type { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import type { EsiOperation } from './catalog.js'
import { esiQuotaCoordinationPrefix, esiPacingKey, normalizeEsiPrincipal } from './cooldowns.js'
import {
  acquireLocalEsiRequestPermit,
  advanceLocalEsiPacing,
  getEsiPacingPolicy,
  getLocalEsiCooldownUntil,
  getLocalEsiPacing,
} from './local-quota.js'
import { EsiQuotaError } from './quota-error.js'
import { wait } from './timing.js'
import type {
  EsiRequestPermit,
  RuntimeLocalQuotaStatePort,
  RuntimeTimingPort,
} from './runtime-ports.js'

const concurrencyLeaseTtlMs = 30_000
const permitPollMs = 50
const systemTiming: Pick<RuntimeTimingPort, 'now' | 'wait'> = { now: () => Date.now(), wait }
const atomicAdmission = `
local time = redis.call('time')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local global = tonumber(redis.call('get', KEYS[2]) or '0')
local scoped = tonumber(redis.call('get', KEYS[3]) or '0')
local cooldown = math.max(global, scoped)
if cooldown > now then return {2, cooldown - now} end
local pacing = redis.call('get', KEYS[4])
local nextAt, expiresAt, interval
if pacing then
  nextAt, expiresAt, interval = string.match(pacing, '^(%d+):(%d+):(%d+)$')
  if not nextAt then return redis.error_reply('Invalid ESI pacing state') end
  if tonumber(nextAt) > now then return {3, tonumber(nextAt) - now} end
end
redis.call('zremrangebyscore', KEYS[1], '-inf', now)
if redis.call('zcard', KEYS[1]) >= tonumber(ARGV[1]) then return {0, 0} end
redis.call('zadd', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('pexpire', KEYS[1], ARGV[2])
if pacing then
  redis.call('set', KEYS[4], (now + tonumber(interval)) .. ':' .. expiresAt .. ':' .. interval, 'KEEPTTL')
end
return {1, 0}
`

const getLocalRetryAt = (
  options: Parameters<typeof acquireEsiRequestPermit>[0],
  principal: string,
  now: number,
) => {
  if (!options.localState) return 0
  const policy = getEsiPacingPolicy(options.operation, options.concurrency)
  return Math.max(
    getLocalEsiCooldownUntil(options.operation, principal, now, options.localState),
    policy ? (getLocalEsiPacing(policy.group, principal, now, options.localState)?.nextAt ?? 0) : 0,
  )
}

const finishDistributedPermit = async (
  permit: EsiRequestPermit,
  options: Parameters<typeof acquireEsiRequestPermit>[0],
  principal: string,
  now: number,
) => {
  const policy = getEsiPacingPolicy(options.operation, options.concurrency)
  if (policy) advanceLocalEsiPacing(policy.group, principal, now, options.localState)
  if (options.signal?.aborted) {
    await permit.release().catch(() => {})
    options.signal.throwIfAborted()
  }
  return permit
}

export async function acquireEsiRequestPermit(options: {
  connection: Redis
  operation: EsiOperation
  principal?: string
  concurrency: number
  queueTimeoutMs: number
  signal?: AbortSignal
  localState?: RuntimeLocalQuotaStatePort
  timing?: Pick<RuntimeTimingPort, 'now' | 'wait'>
}): Promise<EsiRequestPermit> {
  options.signal?.throwIfAborted()
  const timing = options.timing ?? systemTiming
  const principal = normalizeEsiPrincipal(options.principal)
  const deadline = timing.now() + options.queueTimeoutMs
  try {
    while (timing.now() < deadline) {
      const now = timing.now()
      const localRetryAt = getLocalRetryAt(options, principal, now)
      options.signal?.throwIfAborted()
      if (localRetryAt > now) {
        throw new EsiQuotaError(Math.max(1, Math.ceil((localRetryAt - now) / 1000)), now)
      }

      // oxlint-disable-next-line no-await-in-loop
      const result = await tryAcquireDistributedPermit(
        options.connection,
        options.operation,
        principal,
        options.concurrency,
      )
      if (result.kind === 'acquired') {
        // oxlint-disable-next-line no-await-in-loop
        return await finishDistributedPermit(result.permit, options, principal, timing.now())
      }
      options.signal?.throwIfAborted()
      if (result.kind === 'deferred') {
        throw new EsiQuotaError(Math.max(1, Math.ceil(result.retryAfterMs / 1000)), timing.now())
      }
      // oxlint-disable-next-line no-await-in-loop
      await timing.wait(
        Math.min(permitPollMs, Math.max(1, deadline - timing.now())),
        options.signal,
      )
    }
    throw new EsiQuotaError(1)
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof EsiQuotaError) {
      throw error
    }
    return acquireLocalPermit(
      options.operation,
      principal,
      options.concurrency,
      deadline,
      options.signal,
      options.localState,
      timing,
    )
  }
}

async function acquireLocalPermit(
  operation: EsiOperation,
  principal: string,
  sharedConcurrency: number,
  deadline: number,
  signal?: AbortSignal,
  localState?: RuntimeLocalQuotaStatePort,
  timing?: Pick<RuntimeTimingPort, 'now' | 'wait'>,
) {
  const result = await acquireLocalEsiRequestPermit({
    deadline,
    operation,
    principal,
    sharedConcurrency,
    signal,
    state: localState,
    timing,
  })
  if (result.kind === 'acquired') {
    if (signal?.aborted) {
      await result.permit.release().catch(() => {})
      signal.throwIfAborted()
    }
    return result.permit
  }
  throw new EsiQuotaError(result.retryAfterSeconds)
}

async function tryAcquireDistributedPermit(
  connection: Redis,
  operation: EsiOperation,
  principal: string,
  concurrency: number,
): Promise<
  | { kind: 'acquired'; permit: EsiRequestPermit }
  | { kind: 'full' }
  | { kind: 'deferred'; retryAfterMs: number }
> {
  const key = `${esiQuotaCoordinationPrefix}:concurrency:${operation}`
  const ownerToken = randomUUID()
  const policy = getEsiPacingPolicy(operation, concurrency)
  const group = policy?.group
  const scopedCooldownKey = group
    ? `${esiQuotaCoordinationPrefix}:cooldown:group:${group}:${principal}`
    : `${esiQuotaCoordinationPrefix}:cooldown:operation:${operation}:${principal}`
  const rawResult = await connection.eval(
    atomicAdmission,
    4,
    key,
    `${esiQuotaCoordinationPrefix}:cooldown:global`,
    scopedCooldownKey,
    group ? esiPacingKey(group, principal) : `${esiQuotaCoordinationPrefix}:pacing:none`,
    concurrency,
    concurrencyLeaseTtlMs,
    ownerToken,
  )
  if (!Array.isArray(rawResult) || rawResult.length !== 2) {
    throw new Error('Invalid ESI admission result')
  }
  const result = { code: Number(rawResult[0]), retryAfterMs: Number(rawResult[1]) }
  if (
    !Number.isSafeInteger(result.code) ||
    !Number.isSafeInteger(result.retryAfterMs) ||
    result.retryAfterMs < 0
  ) {
    throw new Error('Invalid ESI admission result')
  }
  if (result.code === 0) {
    return { kind: 'full' }
  }
  if (result.code === 2 || result.code === 3) {
    return { kind: 'deferred', retryAfterMs: result.retryAfterMs }
  }
  if (result.code !== 1) {
    throw new Error('Invalid ESI admission result')
  }
  const permit: EsiRequestPermit = {
    coordinationAvailable: true,
    release: async () => {
      await connection.eval(
        "redis.call('zrem', KEYS[1], ARGV[1]); if redis.call('zcard', KEYS[1]) == 0 then redis.call('del', KEYS[1]) end return 1",
        1,
        key,
        ownerToken,
      )
    },
    renew: async () =>
      Number(
        await connection.eval(
          "local time = redis.call('time'); local now = time[1] * 1000 + math.floor(time[2] / 1000); local expiry = redis.call('zscore', KEYS[1], ARGV[1]); if not expiry or tonumber(expiry) <= now then return 0 end redis.call('zadd', KEYS[1], 'XX', now + tonumber(ARGV[2]), ARGV[1]); redis.call('pexpire', KEYS[1], ARGV[2]); return 1",
          1,
          key,
          ownerToken,
          concurrencyLeaseTtlMs,
        ),
      ) === 1,
    ttlMs: concurrencyLeaseTtlMs,
  }
  return { kind: 'acquired', permit }
}
