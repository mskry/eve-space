import { createHash } from 'node:crypto'
import { env } from '../env.js'
import { getSharedCacheRedisConnection } from '../esi-resilience/cache-redis.js'
import type { UniverseId, UniverseName } from './names.js'

const freshMilliseconds = 3_600_000
const retainedSeconds = 7_200
const negativeSeconds = 120
const cachePrefix = `eve-space:universe-resolution:v1:${env.ESI_COMPATIBILITY_DATE}`

interface CachedValue<Value> {
  freshUntil: number
  value: Value
}

export interface ResolutionCacheResult<Key, Value> {
  fresh: Map<Key, Value>
  stale: Map<Key, Value>
  suppressed: Set<Key>
}

export async function readUniverseNames(
  ids: readonly number[],
): Promise<ResolutionCacheResult<number, UniverseName>> {
  return readCache(ids, (id) => String(id), 'name', isUniverseName)
}

export async function writeUniverseNames(entries: readonly UniverseName[]) {
  await writeCache(entries, (entry) => String(entry.id), 'name')
}

export async function suppressUniverseNameIds(ids: readonly number[]) {
  await suppressCache(ids, (id) => String(id), 'name')
}

export async function readUniverseIds(
  names: readonly string[],
): Promise<ResolutionCacheResult<string, UniverseId[]>> {
  return readCache(names, nameCacheId, 'id', isUniverseIds)
}

export async function writeUniverseIds(entries: ReadonlyMap<string, readonly UniverseId[]>) {
  await writeCache(
    [...entries].map(([name, value]) => ({ key: name, value: [...value] })),
    (entry) => nameCacheId(entry.key),
    'id',
    (entry) => entry.value,
  )
}

export async function suppressUniverseIdNames(names: readonly string[]) {
  await suppressCache(names, nameCacheId, 'id')
}

async function readCache<Key, Value>(
  keys: readonly Key[],
  cacheId: (key: Key) => string,
  kind: 'id' | 'name',
  validate: (value: unknown) => value is Value,
): Promise<ResolutionCacheResult<Key, Value>> {
  const result: ResolutionCacheResult<Key, Value> = {
    fresh: new Map(),
    stale: new Map(),
    suppressed: new Set(),
  }
  if (keys.length === 0) return result
  try {
    const connection = getSharedCacheRedisConnection()
    const positiveKeys = keys.map((key) => positiveKey(kind, cacheId(key)))
    const negativeKeys = keys.map((key) => negativeKey(kind, cacheId(key)))
    const [positiveValues, negativeValues] = await Promise.all([
      connection.mget(...positiveKeys),
      connection.mget(...negativeKeys),
    ])
    const now = Date.now()
    for (const [index, key] of keys.entries()) {
      const cached = parseCachedValue(positiveValues[index], validate)
      if (cached) (cached.freshUntil > now ? result.fresh : result.stale).set(key, cached.value)
      if (negativeValues[index] !== null) result.suppressed.add(key)
    }
  } catch {}
  return result
}

async function writeCache<Entry, Value = Entry>(
  entries: readonly Entry[],
  cacheId: (entry: Entry) => string,
  kind: 'id' | 'name',
  selectValue: (entry: Entry) => Value = (entry) => entry as unknown as Value,
) {
  if (entries.length === 0) return
  try {
    const connection = getSharedCacheRedisConnection()
    const transaction = connection.multi()
    const freshUntil = Date.now() + freshMilliseconds
    for (const entry of entries) {
      const id = cacheId(entry)
      transaction.set(
        positiveKey(kind, id),
        JSON.stringify({ freshUntil, value: selectValue(entry) }),
        'EX',
        retainedSeconds,
      )
      transaction.del(negativeKey(kind, id))
    }
    await transaction.exec()
  } catch {}
}

async function suppressCache<Key>(
  keys: readonly Key[],
  cacheId: (key: Key) => string,
  kind: 'id' | 'name',
) {
  if (keys.length === 0) return
  try {
    const transaction = getSharedCacheRedisConnection().multi()
    for (const key of keys)
      transaction.set(negativeKey(kind, cacheId(key)), '1', 'EX', negativeSeconds)
    await transaction.exec()
  } catch {}
}

function positiveKey(kind: 'id' | 'name', id: string) {
  return `${cachePrefix}:${kind}:positive:${id}`
}

function negativeKey(kind: 'id' | 'name', id: string) {
  return `${cachePrefix}:${kind}:negative:${id}`
}

function nameCacheId(name: string) {
  return createHash('sha256').update(name.trim().toLowerCase()).digest('hex')
}

function parseCachedValue<Value>(
  serialized: string | null | undefined,
  validate: (value: unknown) => value is Value,
): CachedValue<Value> | undefined {
  if (!serialized) return undefined
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('freshUntil' in parsed) ||
      !('value' in parsed) ||
      typeof parsed.freshUntil !== 'number' ||
      !validate(parsed.value)
    )
      return undefined
    return { freshUntil: parsed.freshUntil, value: parsed.value }
  } catch {
    return undefined
  }
}

function isUniverseName(value: unknown): value is UniverseName {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'category' in value &&
    typeof value.category === 'string'
  )
}

function isUniverseIds(value: unknown): value is UniverseId[] {
  return Array.isArray(value) && value.every(isUniverseName)
}
