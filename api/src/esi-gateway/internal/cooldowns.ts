import type { EsiResponseMetadata } from '@evespace/esi-client'
import type { Redis } from 'ioredis'
import { getDeclaredEsiRateLimit } from './catalog-access.js'
import { esiOperationCatalog, esiOperations, type EsiOperation } from './catalog.js'
import {
  getEsiPacingPolicy,
  getLocalEsiCooldownUntil,
  getLocalEsiPacing,
  recordLocalEsiCooldowns,
  recordLocalEsiPacing,
} from './local-quota.js'
import type { EsiPacingPolicy } from './local-quota.js'
import { parseFiniteNumber } from './numeric.js'
import {
  esiCooldownFallbackSeconds,
  esiErrorBudgetFloor,
  getLegacyErrorCooldownSeconds,
} from './policy.js'
import type { RuntimeLocalQuotaStatePort } from './runtime-ports.js'

export const esiQuotaCoordinationPrefix = 'eve-space:v1:esi-resilience'

export const esiPacingKey = (group: string, principal: string) =>
  `${esiQuotaCoordinationPrefix}:pacing:group:${group}:${principal}`

const parsePacing = (value: string | null | undefined): number => {
  const nextAt = Number(value?.split(':', 1)[0] ?? 0)
  return Number.isSafeInteger(nextAt) ? nextAt : 0
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
  maximumRequests: number
  concurrency?: number
  now?: number
  localState?: RuntimeLocalQuotaStatePort
}): Promise<readonly EsiRequestCooldown[]> {
  if (options.requests.length > options.maximumRequests) {
    throw new Error('ESI cooldown batch exceeds the resource planner page bound')
  }
  if (options.requests.length === 0) {
    return []
  }
  const now = options.now ?? Date.now()
  const globalKey = `${esiQuotaCoordinationPrefix}:cooldown:global`
  const requestKeys = options.requests.map(({ operation, principal }) => {
    const normalizedPrincipal = normalizeEsiPrincipal(principal)
    return {
      key: cooldownKey(operation, normalizedPrincipal),
      operation,
      principal: normalizedPrincipal,
    }
  })
  const pacingKeys = requestKeys.map(({ operation, principal }) => {
    const policy = getEsiPacingPolicy(operation, options.concurrency ?? 1)
    return policy ? esiPacingKey(policy.group, principal) : undefined
  })
  const keys = [
    globalKey,
    ...new Set([
      ...requestKeys.map(({ key }) => key),
      ...pacingKeys.filter((key) => key !== undefined),
    ]),
  ]
  try {
    const values = await options.connection.mget(...keys)
    const retryAtByKey = new Map(keys.map((key, index) => [key, Number(values[index] ?? 0)]))
    const globalRetryAt = retryAtByKey.get(globalKey) ?? 0
    return requestKeys.map(({ key, operation, principal }, index) => {
      const localGroup = getEsiPacingPolicy(operation, options.concurrency ?? 1)?.group
      const localNext = localGroup
        ? (getLocalEsiPacing(localGroup, principal, now, options.localState)?.nextAt ?? 0)
        : 0
      const sharedNext = parsePacing(values[keys.indexOf(pacingKeys[index] ?? '')])
      return toCooldown(
        Math.max(globalRetryAt, retryAtByKey.get(key) ?? 0, localNext, sharedNext),
        now,
        true,
      )
    })
  } catch {
    return requestKeys.map(({ operation, principal }) =>
      toCooldown(
        Math.max(
          getLocalEsiCooldownUntil(operation, principal, now, options.localState),
          getLocalPacingNext(
            operation,
            principal,
            now,
            options.concurrency ?? 1,
            options.localState,
          ),
        ),
        now,
        false,
      ),
    )
  }
}

export async function getEsiRequestCooldown(options: {
  connection: Pick<Redis, 'get'>
  operation: EsiOperation
  principal?: string
  now?: number
  localState?: RuntimeLocalQuotaStatePort
  concurrency?: number
}): Promise<EsiRequestCooldown> {
  const principal = normalizeEsiPrincipal(options.principal)
  const now = options.now ?? Date.now()
  let retryAt: number
  let coordinationAvailable = true
  try {
    const policy = getEsiPacingPolicy(options.operation, options.concurrency ?? 1)
    const [globalCooldown, operationCooldown, pacing] = await Promise.all([
      options.connection.get(`${esiQuotaCoordinationPrefix}:cooldown:global`),
      options.connection.get(cooldownKey(options.operation, principal)),
      policy
        ? options.connection.get(esiPacingKey(policy.group, principal))
        : Promise.resolve(null),
    ])
    retryAt = Math.max(
      Number(globalCooldown ?? 0),
      Number(operationCooldown ?? 0),
      parsePacing(pacing),
      getLocalPacingNext(
        options.operation,
        principal,
        now,
        options.concurrency ?? 1,
        options.localState,
      ),
    )
  } catch {
    coordinationAvailable = false
    retryAt = Math.max(
      getLocalEsiCooldownUntil(options.operation, principal, now, options.localState),
      getLocalPacingNext(
        options.operation,
        principal,
        now,
        options.concurrency ?? 1,
        options.localState,
      ),
    )
  }
  return toCooldown(retryAt, now, coordinationAvailable)
}

const getPacingObservation = (
  operation: EsiOperation,
  metadata: EsiResponseMetadata,
  concurrency: number,
): { policy: EsiPacingPolicy; remaining: number } | undefined => {
  if (metadata.status === 429 || metadata.status === 420) return undefined
  const policy = getEsiPacingPolicy(operation, concurrency)
  const remaining = metadata.routeRateLimit?.remaining
  if (!policy || remaining === undefined || !Number.isSafeInteger(remaining) || remaining < 0) {
    return undefined
  }
  const observedGroup = metadata.routeRateLimit?.group
  if (observedGroup !== undefined && observedGroup !== policy.group) return undefined
  return remaining <= policy.margin ? { policy, remaining } : undefined
}

const getResponseCooldownDeadlines = (metadata: EsiResponseMetadata, now: number) => {
  const remaining = metadata.errorLimit?.remaining
  const globalRetryAt =
    metadata.status === 420 || (remaining !== undefined && remaining <= esiErrorBudgetFloor)
      ? now + getLegacyErrorCooldownSeconds(metadata.errorLimit?.reset) * 1000
      : undefined
  const operationRetryAt =
    metadata.status === 429
      ? now + (metadata.retryAfterSeconds ?? esiCooldownFallbackSeconds) * 1000
      : undefined
  return { globalRetryAt, operationRetryAt }
}

const getLocalPacingNext = (
  operation: EsiOperation,
  principal: string,
  now: number,
  concurrency: number,
  state?: RuntimeLocalQuotaStatePort,
) => {
  if (!state) return 0
  const group = getEsiPacingPolicy(operation, concurrency)?.group
  return group ? (getLocalEsiPacing(group, principal, now, state)?.nextAt ?? 0) : 0
}

const recordSharedPacing = async (
  connection: Redis,
  policy: NonNullable<ReturnType<typeof getEsiPacingPolicy>>,
  principal: string,
  remaining: number,
) => {
  const intervalMs = remaining < 5 ? 60_000 : policy.intervalMs
  await connection.eval(
    "local time = redis.call('time'); local now = time[1] * 1000 + math.floor(time[2] / 1000); local current = redis.call('get', KEYS[1]); local nextAt = now + tonumber(ARGV[1]); local interval = tonumber(ARGV[1]); if current then local previousNext, _, previousInterval = string.match(current, '^(%d+):(%d+):(%d+)$'); if previousNext then nextAt = math.max(nextAt, tonumber(previousNext)); interval = math.max(interval, tonumber(previousInterval)) end end; redis.call('set', KEYS[1], nextAt .. ':' .. (now + tonumber(ARGV[2])) .. ':' .. interval, 'PX', ARGV[2]); return nextAt - now",
    1,
    esiPacingKey(policy.group, principal),
    Math.ceil(intervalMs),
    policy.windowMs,
  )
}

export async function recordEsiResponse(options: {
  connection: Redis
  operation: EsiOperation
  principal?: string
  metadata: EsiResponseMetadata
  localState?: RuntimeLocalQuotaStatePort
  now?: number
  concurrency?: number
}): Promise<void> {
  const principal = normalizeEsiPrincipal(options.principal)
  const now = options.now ?? Date.now()
  const observation = getPacingObservation(
    options.operation,
    options.metadata,
    options.concurrency ?? 1,
  )
  if (observation) {
    recordLocalEsiPacing(
      observation.policy,
      principal,
      observation.remaining,
      now,
      options.localState,
    )
  }
  const { globalRetryAt, operationRetryAt } = getResponseCooldownDeadlines(options.metadata, now)
  const cooldowns: Array<[string, number]> = []
  if (globalRetryAt !== undefined) {
    cooldowns.push([`${esiQuotaCoordinationPrefix}:cooldown:global`, globalRetryAt])
  }
  if (operationRetryAt !== undefined) {
    cooldowns.push([cooldownKey(options.operation, principal), operationRetryAt])
  }
  recordLocalEsiCooldowns({
    globalRetryAt,
    now,
    operation: options.operation,
    operationRetryAt,
    principal,
    state: options.localState,
  })
  try {
    await Promise.all([
      ...cooldowns.map(([key, value]) => setCooldownAtLeast(options.connection, key, value, now)),
      ...(observation
        ? [
            recordSharedPacing(
              options.connection,
              observation.policy,
              principal,
              observation.remaining,
            ),
          ]
        : []),
    ])
  } catch {
    // The local values are intentionally tighter and only used while coordination is unreachable.
  }
}

/** Safe operator view of shared public cooldowns; principal-specific windows remain private. */
export async function getSharedEsiCooldownStatus(connection: Redis): Promise<EsiCooldownStatus> {
  const checkedAt = new Date().toISOString()
  try {
    const now = Date.now()
    const operations = esiOperations
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
      activeOperations,
      checkedAt,
      globalRetryAt,
      status: globalRetryAt || activeOperations.length > 0 ? 'active' : 'inactive',
    }
  } catch {
    return { activeOperations: [], checkedAt, globalRetryAt: null, status: 'unavailable' }
  }
}

export function normalizeEsiPrincipal(principal: string | undefined) {
  if (!principal) {
    return 'public'
  }
  if (!/^[a-z0-9_-]+$/i.test(principal)) {
    throw new Error('Invalid ESI principal identity')
  }
  return principal
}

function toCooldown(
  retryAt: number,
  now: number,
  coordinationAvailable: boolean,
): EsiRequestCooldown {
  return {
    active: retryAt > now,
    coordinationAvailable,
    retryAfterSeconds: retryAt > now ? Math.max(1, Math.ceil((retryAt - now) / 1000)) : null,
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
    Math.max(1000, retryAt - now),
  )
}

function toFutureTimestamp(value: string | null | undefined, now: number) {
  const retryAt = parseFiniteNumber(value)
  return retryAt !== undefined && retryAt > now ? new Date(retryAt).toISOString() : null
}

function getDeclaredEsiRateGroup(operation: EsiOperation) {
  return getDeclaredEsiRateLimit(esiOperationCatalog[operation])?.group
}
