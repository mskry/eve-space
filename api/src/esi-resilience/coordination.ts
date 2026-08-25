import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { EsiRepresentationIdentity } from './identity.js'
import { cacheCoordinationSentinelKey } from './namespaces.js'

const coordinationIdentityVersion = 'v2'
const keyPrefix = `eve-space:${coordinationIdentityVersion}:esi-resilience`
const esiRequestLeaseTtlMs = 15_000
const fenceStateTtlMs = 86_400_000

export interface EsiRequestLease {
  key: string
  ownerToken: string
  fence: number
  ttlMs: number
}

function identityKey(identity: EsiRepresentationIdentity) {
  return `${identity.operation}:${identity.digest}`
}

export async function initializeCacheNamespace(coordination: Redis) {
  const namespace = await coordination.eval(
    "local current = redis.call('get', KEYS[1]); if current and current ~= ARGV[1] then return current end; redis.call('set', KEYS[1], ARGV[2]); return ARGV[2]",
    1,
    cacheCoordinationSentinelKey,
    '1',
    randomUUID(),
  )
  if (typeof namespace !== 'string' || !/^[0-9a-f-]{36}$/i.test(namespace))
    throw new Error('Invalid cache namespace')
  return namespace
}

export async function acquireEsiRequestLease(
  connection: Redis,
  identity: EsiRepresentationIdentity,
  leaseTtlMs = esiRequestLeaseTtlMs,
): Promise<EsiRequestLease | undefined> {
  const keyIdentity = identityKey(identity)
  const key = `${keyPrefix}:lease:${keyIdentity}`
  const ownerToken = randomUUID()
  const result = (await connection.eval(
    "if redis.call('exists', KEYS[1]) == 1 then return nil end local fence = redis.call('incr', KEYS[2]); redis.call('pexpire', KEYS[2], ARGV[3]); redis.call('psetex', KEYS[1], ARGV[1], ARGV[2] .. ':' .. fence); return fence",
    2,
    key,
    `${keyPrefix}:fence-counter:${keyIdentity}`,
    leaseTtlMs,
    ownerToken,
    fenceStateTtlMs,
  )) as number | null
  return result === null ? undefined : { key, ownerToken, fence: Number(result), ttlMs: leaseTtlMs }
}

export async function getEsiRequestLeaseTtl(
  connection: Redis,
  identity: EsiRepresentationIdentity,
) {
  return Math.max(0, Number(await connection.pttl(`${keyPrefix}:lease:${identityKey(identity)}`)))
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

export async function commitEsiFence(
  connection: Redis,
  identity: EsiRepresentationIdentity,
  lease: EsiRequestLease,
) {
  const committedKey = `${keyPrefix}:committed-fence:${identityKey(identity)}`
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

export async function getCommittedEsiFence(connection: Redis, identity: EsiRepresentationIdentity) {
  const value = await connection.get(`${keyPrefix}:committed-fence:${identityKey(identity)}`)
  return value === null ? undefined : Number(value)
}
