import type { Redis } from 'ioredis'
import { env } from '../env.js'
import { getDeclaredEsiRateLimit } from './catalog-access.js'
import { esiOperationCatalog, type EsiOperation } from './catalog.js'
import { getLocalEsiCooldownUntil, recordLocalEsiCooldowns } from './local-quota.js'
import { parseFiniteNumber, parseNonnegativeFiniteNumber } from './numeric.js'
import { esiCooldownFallbackSeconds, esiErrorBudgetFloor } from './policy.js'

export const esiQuotaCoordinationPrefix = 'eve-space:v1:esi-resilience'

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
  const globalKey = `${esiQuotaCoordinationPrefix}:cooldown:global`
  const requestKeys = options.requests.map(({ operation, principal }) => {
    const normalizedPrincipal = normalizeEsiPrincipal(principal)
    return {
      operation,
      principal: normalizedPrincipal,
      key: cooldownKey(operation, normalizedPrincipal),
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
    return requestKeys.map(({ operation, principal }) =>
      toCooldown(getLocalEsiCooldownUntil(operation, principal, now), now, false),
    )
  }
}

export async function getEsiRequestCooldown(options: {
  connection: Pick<Redis, 'get'>
  operation: EsiOperation
  principal?: string
  now?: number
}): Promise<EsiRequestCooldown> {
  const principal = normalizeEsiPrincipal(options.principal)
  const now = options.now ?? Date.now()
  let retryAt: number
  let coordinationAvailable = true
  try {
    const [globalCooldown, operationCooldown] = await Promise.all([
      options.connection.get(`${esiQuotaCoordinationPrefix}:cooldown:global`),
      options.connection.get(cooldownKey(options.operation, principal)),
    ])
    retryAt = Math.max(Number(globalCooldown ?? 0), Number(operationCooldown ?? 0))
  } catch {
    coordinationAvailable = false
    retryAt = getLocalEsiCooldownUntil(options.operation, principal, now)
  }
  return toCooldown(retryAt, now, coordinationAvailable)
}

export async function recordEsiResponse(options: {
  connection: Redis
  operation: EsiOperation
  principal?: string
  status: number
  headers: Headers
}): Promise<void> {
  const errorRemaining = parseNonnegativeFiniteNumber(
    options.headers.get('x-esi-error-limit-remain'),
  )
  const errorResetSeconds = parseNonnegativeFiniteNumber(
    options.headers.get('x-esi-error-limit-reset'),
  )
  const retryAfterSeconds = parseNonnegativeFiniteNumber(options.headers.get('retry-after'))
  const principal = normalizeEsiPrincipal(options.principal)
  const now = Date.now()
  const globalRetryAt =
    errorRemaining !== undefined && errorRemaining <= esiErrorBudgetFloor
      ? now + (errorResetSeconds ?? esiCooldownFallbackSeconds) * 1_000
      : undefined
  const operationRetryAt =
    options.status === 429
      ? now + (retryAfterSeconds ?? esiCooldownFallbackSeconds) * 1_000
      : undefined
  const cooldowns: Array<[string, number]> = []
  if (globalRetryAt !== undefined)
    cooldowns.push([`${esiQuotaCoordinationPrefix}:cooldown:global`, globalRetryAt])
  if (operationRetryAt !== undefined)
    cooldowns.push([cooldownKey(options.operation, principal), operationRetryAt])
  recordLocalEsiCooldowns({
    operation: options.operation,
    principal,
    globalRetryAt,
    operationRetryAt,
  })
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
    const globalCooldown = await connection.get(`${esiQuotaCoordinationPrefix}:cooldown:global`)
    const operationCooldowns = await Promise.all(
      operations.map((operation) => connection.get(cooldownKey(operation, 'public'))),
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

export function normalizeEsiPrincipal(principal: string | undefined) {
  if (!principal) return 'public'
  if (!/^[a-z0-9_-]+$/i.test(principal)) throw new Error('Invalid ESI principal identity')
  return principal
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

function cooldownKey(operation: EsiOperation, principal: string) {
  const group = getDeclaredEsiRateGroup(operation)
  return group
    ? `${esiQuotaCoordinationPrefix}:cooldown:group:${group}:${principal}`
    : `${esiQuotaCoordinationPrefix}:cooldown:operation:${operation}:${principal}`
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

function toFutureTimestamp(value: string | null | undefined, now: number) {
  const retryAt = parseFiniteNumber(value)
  return retryAt !== undefined && retryAt > now ? new Date(retryAt).toISOString() : null
}

function getDeclaredEsiRateGroup(operation: EsiOperation) {
  return getDeclaredEsiRateLimit(esiOperationCatalog[operation])?.group
}
