import type { Redis } from 'ioredis'
import { esiCooldownFallbackSeconds, esiErrorBudgetFloor } from './policy.js'
import { env } from '../env.js'
import { esiOperationCatalog, type EsiOperation } from './catalog.js'

const quotaCoordinationPrefix = 'eve-space:v1:esi-resilience'
const concurrencyLeaseTtlMs = 30_000
const permitPollMs = 50
const maximumLocalCooldowns = 1_000
const localOperationCooldowns = new Map<string, number>()
const localGroupCooldowns = new Map<string, number>()
const localInFlight = new Map<string, number>()
let localGlobalCooldownUntil = 0

export class EsiQuotaError extends Error {
  readonly retryAt: Date

  constructor(
    readonly retryAfterSeconds: number,
    now = Date.now(),
    retryAt?: Date,
  ) {
    super('ESI quota is temporarily exhausted')
    this.name = 'EsiQuotaError'
    this.retryAt = retryAt ?? new Date(now + retryAfterSeconds * 1_000)
  }
}

export interface EsiRequestPermit {
  coordinationAvailable: boolean
  renew(): Promise<boolean>
  release(): Promise<void>
}

export interface EsiCooldownStatus {
  status: 'inactive' | 'active' | 'unavailable'
  checkedAt: string
  globalRetryAt: string | null
  activeOperations: Array<{ operation: EsiOperation; retryAt: string }>
}

export interface EsiRequestCooldown {
  active: boolean
  retryAfterSeconds: number | null
  coordinationAvailable: boolean
}

export interface EsiCooldownRequest {
  readonly operation: EsiOperation
  readonly principal?: string
}

interface EsiCooldownBatchConnection {
  mget(...keys: string[]): Promise<(string | null)[]>
}

export async function getEsiRequestCooldowns(options: {
  connection: EsiCooldownBatchConnection
  requests: readonly EsiCooldownRequest[]
  now?: number
}): Promise<readonly EsiRequestCooldown[]> {
  if (options.requests.length > env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE)
    throw new Error('ESI cooldown batch exceeds the resource planner page bound')
  if (options.requests.length === 0) return []
  const now = options.now ?? Date.now()
  const globalKey = `${quotaCoordinationPrefix}:cooldown:global`
  const requestKeys = options.requests.map(({ operation, principal }) => {
    const normalizedPrincipal = normalizePrincipal(principal)
    return {
      operation,
      principal: normalizedPrincipal,
      identity: `${operation}:${normalizedPrincipal}`,
      key: cooldownKey(operation, `${operation}:${normalizedPrincipal}`, principal),
    }
  })
  const keys = [globalKey, ...new Set(requestKeys.map(({ key }) => key))]
  try {
    const values = await options.connection.mget(...keys)
    const retryAtByKey = new Map(keys.map((key, index) => [key, Number(values[index] ?? 0)]))
    const globalRetryAt = retryAtByKey.get(globalKey) ?? 0
    return requestKeys.map(({ key }) =>
      toCooldown(Math.max(globalRetryAt, retryAtByKey.get(key) ?? 0), now, true),
    )
  } catch {
    return requestKeys.map(({ operation, identity, principal }) =>
      toCooldown(localCooldownUntil(operation, identity, principal, now), now, false),
    )
  }
}

export async function getEsiRequestCooldown(options: {
  connection: Pick<Redis, 'get'>
  operation: EsiOperation
  principal?: string
  now?: number
}): Promise<EsiRequestCooldown> {
  const principal = normalizePrincipal(options.principal)
  const identity = `${options.operation}:${principal}`
  const now = options.now ?? Date.now()
  let retryAt: number
  let coordinationAvailable = true
  try {
    const [globalCooldown, operationCooldown] = await Promise.all([
      options.connection.get(`${quotaCoordinationPrefix}:cooldown:global`),
      options.connection.get(cooldownKey(options.operation, identity, options.principal)),
    ])
    retryAt = Math.max(Number(globalCooldown ?? 0), Number(operationCooldown ?? 0))
  } catch {
    coordinationAvailable = false
    retryAt = localCooldownUntil(options.operation, identity, principal, now)
  }
  return {
    active: retryAt > now,
    retryAfterSeconds: retryAt > now ? Math.max(1, Math.ceil((retryAt - now) / 1_000)) : null,
    coordinationAvailable,
  }
}

function toCooldown(
  retryAt: number,
  now: number,
  coordinationAvailable: boolean,
): EsiRequestCooldown {
  return {
    active: retryAt > now,
    retryAfterSeconds: retryAt > now ? Math.max(1, Math.ceil((retryAt - now) / 1_000)) : null,
    coordinationAvailable,
  }
}

export async function acquireEsiRequestPermit(options: {
  connection: Redis
  operation: EsiOperation
  principal?: string
  concurrency: number
  queueTimeoutMs?: number
}): Promise<EsiRequestPermit> {
  const identity = `${options.operation}:${normalizePrincipal(options.principal)}`
  const deadline = Date.now() + (options.queueTimeoutMs ?? env.ESI_OPERATION_QUEUE_TIMEOUT_MS)
  try {
    while (Date.now() < deadline) {
      const now = Date.now()
      // oxlint-disable-next-line no-await-in-loop
      const [globalCooldown, operationCooldown] = await Promise.all([
        options.connection.get(`${quotaCoordinationPrefix}:cooldown:global`),
        options.connection.get(cooldownKey(options.operation, identity, options.principal)),
      ])
      const retryAt = Math.max(Number(globalCooldown ?? 0), Number(operationCooldown ?? 0))
      if (retryAt > now) throw new EsiQuotaError(Math.max(1, Math.ceil((retryAt - now) / 1_000)))

      // oxlint-disable-next-line no-await-in-loop
      const permit = await tryAcquireDistributedPermit(
        options.connection,
        options.operation,
        options.concurrency,
      )
      if (permit) return permit
      // oxlint-disable-next-line no-await-in-loop
      await wait(Math.min(permitPollMs, Math.max(1, deadline - Date.now())))
    }
    throw new EsiQuotaError(1)
  } catch (error) {
    if (error instanceof EsiQuotaError) throw error
    return acquireLocalPermit(options.operation, identity, options.concurrency, deadline)
  }
}

export async function recordEsiResponse(options: {
  connection: Redis
  operation: EsiOperation
  principal?: string
  status: number
  headers: Headers
}): Promise<void> {
  const errorRemaining = parseNumber(options.headers.get('x-esi-error-limit-remain'))
  const errorResetSeconds = parseNumber(options.headers.get('x-esi-error-limit-reset'))
  const retryAfterSeconds = parseNumber(options.headers.get('retry-after'))
  const declaredGroup = getDeclaredRateGroup(options.operation)
  const principal = normalizePrincipal(options.principal)
  const identity = `${options.operation}:${principal}`
  const now = Date.now()
  const cooldowns: Array<[string, number]> = []
  if (errorRemaining !== undefined && errorRemaining <= esiErrorBudgetFloor)
    cooldowns.push([
      `${quotaCoordinationPrefix}:cooldown:global`,
      now + (errorResetSeconds ?? esiCooldownFallbackSeconds) * 1_000,
    ])
  if (options.status === 429) {
    const retryAt = now + (retryAfterSeconds ?? esiCooldownFallbackSeconds) * 1_000
    cooldowns.push([cooldownKey(options.operation, identity, options.principal), retryAt])
  }
  recordLocalCooldowns(identity, principal, declaredGroup, cooldowns)
  try {
    await Promise.all(
      cooldowns.map(([key, value]) => setCooldownAtLeast(options.connection, key, value, now)),
    )
  } catch {
    // The local values are intentionally tighter and only used while coordination is unreachable.
  }
}

/** Safe operator view of shared public cooldowns; principal-specific windows remain private. */
export async function getSharedEsiCooldownStatus(connection: Redis): Promise<EsiCooldownStatus> {
  const checkedAt = new Date().toISOString()
  try {
    const now = Date.now()
    const operations = Object.keys(esiOperationCatalog) as EsiOperation[]
    const globalCooldown = await connection.get(`${quotaCoordinationPrefix}:cooldown:global`)
    const operationCooldowns = await Promise.all(
      operations.map((operation) =>
        connection.get(cooldownKey(operation, `${operation}:public`, undefined)),
      ),
    )
    const globalRetryAt = toFutureTimestamp(globalCooldown, now)
    const activeOperations = operations.flatMap((operation, index) => {
      const retryAt = toFutureTimestamp(operationCooldowns[index], now)
      return retryAt ? [{ operation, retryAt }] : []
    })
    return {
      status: globalRetryAt || activeOperations.length > 0 ? 'active' : 'inactive',
      checkedAt,
      globalRetryAt,
      activeOperations,
    }
  } catch {
    return { status: 'unavailable', checkedAt, globalRetryAt: null, activeOperations: [] }
  }
}

async function acquireLocalPermit(
  operation: EsiOperation,
  identity: string,
  sharedConcurrency: number,
  deadline: number,
): Promise<EsiRequestPermit> {
  const limit = Math.max(1, Math.floor(sharedConcurrency / 2))
  while (Date.now() < deadline) {
    const now = Date.now()
    const principal = identity.slice(operation.length + 1)
    const cooldownUntil = localCooldownUntil(operation, identity, principal, now)
    if (cooldownUntil > now)
      throw new EsiQuotaError(Math.max(1, Math.ceil((cooldownUntil - now) / 1_000)))
    const count = localInFlight.get(operation) ?? 0
    if (count < limit) {
      localInFlight.set(operation, count + 1)
      return {
        coordinationAvailable: false,
        renew: async () => true,
        async release() {
          const current = localInFlight.get(operation) ?? 0
          if (current <= 1) localInFlight.delete(operation)
          else localInFlight.set(operation, current - 1)
        },
      }
    }
    // oxlint-disable-next-line no-await-in-loop
    await wait(Math.min(permitPollMs, Math.max(1, deadline - Date.now())))
  }
  throw new EsiQuotaError(1)
}

function localCooldownUntil(
  operation: EsiOperation,
  identity: string,
  principal: string,
  now: number,
) {
  pruneLocalCooldowns(now)
  const group = getDeclaredRateGroup(operation)
  return Math.max(
    localGlobalCooldownUntil,
    localOperationCooldowns.get(identity) ?? 0,
    group ? (localGroupCooldowns.get(`${group}:${principal}`) ?? 0) : 0,
  )
}

function recordLocalCooldowns(
  identity: string,
  principal: string,
  group: string | undefined,
  cooldowns: Array<[string, number]>,
) {
  const now = Date.now()
  pruneLocalCooldowns(now)
  for (const [key, retryAt] of cooldowns) {
    if (key.endsWith(':global'))
      localGlobalCooldownUntil = Math.max(localGlobalCooldownUntil, retryAt)
  }
  const operationCooldown = cooldowns.find(([key]) => key.includes(':cooldown:operation:'))?.[1]
  if (operationCooldown !== undefined)
    localOperationCooldowns.set(
      identity,
      Math.max(localOperationCooldowns.get(identity) ?? 0, operationCooldown),
    )
  if (group) {
    const groupCooldown = cooldowns.find(([key]) => key.includes(':cooldown:group:'))?.[1]
    if (groupCooldown !== undefined) {
      const key = `${group}:${principal}`
      localGroupCooldowns.set(key, Math.max(localGroupCooldowns.get(key) ?? 0, groupCooldown))
    }
  }
  boundLocalCooldowns(localOperationCooldowns)
  boundLocalCooldowns(localGroupCooldowns)
}

function cooldownKey(operation: EsiOperation, identity: string, principal: string | undefined) {
  const group = getDeclaredRateGroup(operation)
  return group
    ? `${quotaCoordinationPrefix}:cooldown:group:${group}:${normalizePrincipal(principal)}`
    : `${quotaCoordinationPrefix}:cooldown:operation:${identity}`
}

function getDeclaredRateGroup(operation: EsiOperation) {
  const rateGroup = esiOperationCatalog[operation].rateGroup
  return rateGroup.kind === 'declared' ? rateGroup.group : undefined
}

async function setCooldownAtLeast(connection: Redis, key: string, retryAt: number, now: number) {
  await connection.eval(
    "local current = tonumber(redis.call('get', KEYS[1]) or '0'); local candidate = tonumber(ARGV[1]); if candidate <= current then return 0 end return redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2])",
    1,
    key,
    retryAt,
    Math.max(1_000, retryAt - now),
  )
}

async function tryAcquireDistributedPermit(
  connection: Redis,
  operation: EsiOperation,
  concurrency: number,
): Promise<EsiRequestPermit | undefined> {
  const key = `${quotaCoordinationPrefix}:concurrency:${operation}`
  const ownerToken = crypto.randomUUID()
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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function normalizePrincipal(principal: string | undefined) {
  if (!principal) return 'public'
  if (!/^[a-z0-9_-]+$/i.test(principal)) throw new Error('Invalid ESI principal identity')
  return principal
}

function parseNumber(value: string | null) {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function toFutureTimestamp(value: string | null | undefined, now: number) {
  const retryAt = Number(value)
  return Number.isFinite(retryAt) && retryAt > now ? new Date(retryAt).toISOString() : null
}
