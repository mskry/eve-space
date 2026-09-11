import type { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { env } from '../env.js'
import type { EsiOperation } from './catalog.js'
import {
  EsiQuotaError,
  esiQuotaCoordinationPrefix,
  getEsiRequestCooldown,
  normalizeEsiPrincipal,
} from './cooldowns.js'
import { acquireLocalEsiRequestPermit } from './local-quota.js'
import { wait } from './timing.js'

const concurrencyLeaseTtlMs = 30_000
const permitPollMs = 50

export interface EsiRequestPermit {
  coordinationAvailable: boolean
  /** Lifetime of the underlying concurrency lease; holders must renew well inside it. */
  ttlMs: number
  renew(): Promise<boolean>
  release(): Promise<void>
}

export async function acquireEsiRequestPermit(options: {
  connection: Redis
  operation: EsiOperation
  principal?: string
  concurrency: number
  queueTimeoutMs?: number
  signal?: AbortSignal
}): Promise<EsiRequestPermit> {
  options.signal?.throwIfAborted()
  const principal = normalizeEsiPrincipal(options.principal)
  const deadline = Date.now() + (options.queueTimeoutMs ?? env.ESI_OPERATION_QUEUE_TIMEOUT_MS)
  try {
    while (Date.now() < deadline) {
      const now = Date.now()
      // oxlint-disable-next-line no-await-in-loop
      const cooldown = await getEsiRequestCooldown({
        connection: options.connection,
        operation: options.operation,
        principal,
        now,
      })
      options.signal?.throwIfAborted()
      if (!cooldown.coordinationAvailable)
        return acquireLocalPermit(
          options.operation,
          principal,
          options.concurrency,
          deadline,
          options.signal,
        )
      if (cooldown.active) throw new EsiQuotaError(cooldown.retryAfterSeconds!, now)

      // oxlint-disable-next-line no-await-in-loop
      const permit = await tryAcquireDistributedPermit(
        options.connection,
        options.operation,
        options.concurrency,
      )
      if (permit) {
        if (options.signal?.aborted) {
          // oxlint-disable-next-line no-await-in-loop
          await permit.release().catch(() => {})
          options.signal.throwIfAborted()
        }
        return permit
      }
      // oxlint-disable-next-line no-await-in-loop
      await wait(Math.min(permitPollMs, Math.max(1, deadline - Date.now())), options.signal)
    }
    throw new EsiQuotaError(1)
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof EsiQuotaError) throw error
    return acquireLocalPermit(
      options.operation,
      principal,
      options.concurrency,
      deadline,
      options.signal,
    )
  }
}

async function acquireLocalPermit(
  operation: EsiOperation,
  principal: string,
  sharedConcurrency: number,
  deadline: number,
  signal?: AbortSignal,
) {
  const result = await acquireLocalEsiRequestPermit({
    operation,
    principal,
    sharedConcurrency,
    deadline,
    signal,
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
  concurrency: number,
): Promise<EsiRequestPermit | undefined> {
  const key = `${esiQuotaCoordinationPrefix}:concurrency:${operation}`
  const ownerToken = randomUUID()
  const now = Date.now()
  const acquired =
    Number(
      await connection.eval(
        "local now = tonumber(ARGV[1]); redis.call('zremrangebyscore', KEYS[1], '-inf', now); if redis.call('zcard', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end redis.call('zadd', KEYS[1], now + tonumber(ARGV[3]), ARGV[4]); redis.call('pexpire', KEYS[1], ARGV[3]); return 1",
        1,
        key,
        now,
        concurrency,
        concurrencyLeaseTtlMs,
        ownerToken,
      ),
    ) === 1
  if (!acquired) return undefined
  return {
    coordinationAvailable: true,
    ttlMs: concurrencyLeaseTtlMs,
    renew: async () =>
      Number(
        await connection.eval(
          "local now = tonumber(ARGV[1]); local expiry = redis.call('zscore', KEYS[1], ARGV[2]); if not expiry or tonumber(expiry) <= now then return 0 end redis.call('zadd', KEYS[1], 'XX', now + tonumber(ARGV[3]), ARGV[2]); redis.call('pexpire', KEYS[1], ARGV[3]); return 1",
          1,
          key,
          Date.now(),
          ownerToken,
          concurrencyLeaseTtlMs,
        ),
      ) === 1,
    release: async () => {
      await connection.eval(
        "redis.call('zrem', KEYS[1], ARGV[1]); if redis.call('zcard', KEYS[1]) == 0 then redis.call('del', KEYS[1]) end return 1",
        1,
        key,
        ownerToken,
      )
    },
  }
}
