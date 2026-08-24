import { createHash, randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { cacheCoordinationSentinelKey, cacheNamespaceVersionKey } from './namespaces.js'

const keyPrefix = 'eve-space:v1:esi-resilience'
const esiRequestLeaseTtlMs = 15_000
const fenceStateTtlMs = 86_400_000

export interface EsiRequestLease {
  key: string
  ownerToken: string
  fence: number
  ttlMs: number
}

function resourceHash(resource: string) {
  return createHash('sha256').update(resource).digest('base64url')
}

export async function initializeCacheNamespace(cache: Redis, coordination: Redis) {
  const existingVersion = await cache.get(cacheNamespaceVersionKey)
  const sentinelWasWritten =
    (await coordination.set(cacheCoordinationSentinelKey, '1', 'NX')) === 'OK'
  if (existingVersion === null) {
    const version = await cache.set(cacheNamespaceVersionKey, '1', 'NX')
    return version === 'OK' ? 1 : parseNamespaceVersion(await cache.get(cacheNamespaceVersionKey))
  }
  if (sentinelWasWritten) return parseNamespaceVersion(await cache.incr(cacheNamespaceVersionKey))
  return parseNamespaceVersion(existingVersion)
}

export async function acquireEsiRequestLease(
  connection: Redis,
  resource: string,
  leaseTtlMs = esiRequestLeaseTtlMs,
): Promise<EsiRequestLease | undefined> {
  const hash = resourceHash(resource)
  const key = `${keyPrefix}:lease:${hash}`
  const ownerToken = randomUUID()
  const result = (await connection.eval(
    "if redis.call('exists', KEYS[1]) == 1 then return nil end local fence = redis.call('incr', KEYS[2]); redis.call('pexpire', KEYS[2], ARGV[3]); redis.call('psetex', KEYS[1], ARGV[1], ARGV[2] .. ':' .. fence); return fence",
    2,
    key,
    `${keyPrefix}:fence-counter:${hash}`,
    leaseTtlMs,
    ownerToken,
    fenceStateTtlMs,
  )) as number | null
  return result === null ? undefined : { key, ownerToken, fence: Number(result), ttlMs: leaseTtlMs }
}

export async function getEsiRequestLeaseTtl(connection: Redis, resource: string) {
  return Math.max(0, Number(await connection.pttl(`${keyPrefix}:lease:${resourceHash(resource)}`)))
}

export async function renewEsiRequestLease(connection: Redis, lease: EsiRequestLease) {
  return (
    Number(
      await connection.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        lease.key,
        `${lease.ownerToken}:${lease.fence}`,
        lease.ttlMs,
      ),
    ) === 1
  )
}

export async function releaseEsiRequestLease(connection: Redis, lease: EsiRequestLease) {
  return (
    Number(
      await connection.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lease.key,
        `${lease.ownerToken}:${lease.fence}`,
      ),
    ) === 1
  )
}

export async function commitEsiFence(connection: Redis, resource: string, lease: EsiRequestLease) {
  const hash = resourceHash(resource)
  const committedKey = `${keyPrefix}:committed-fence:${hash}`
  const leaseValue = `${lease.ownerToken}:${lease.fence}`
  return (
    Number(
      await connection.eval(
        "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end local current = tonumber(redis.call('get', KEYS[2]) or '-1'); local candidate = tonumber(ARGV[2]); if candidate < current then return 0 end redis.call('set', KEYS[2], ARGV[2], 'PX', ARGV[3]); return 1",
        2,
        lease.key,
        committedKey,
        leaseValue,
        lease.fence,
        fenceStateTtlMs,
      ),
    ) === 1
  )
}

export async function getCommittedEsiFence(connection: Redis, resource: string) {
  const value = await connection.get(`${keyPrefix}:committed-fence:${resourceHash(resource)}`)
  return value === null ? undefined : Number(value)
}

function parseNamespaceVersion(value: string | number | null) {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('Invalid cache namespace version')
  return version
}
