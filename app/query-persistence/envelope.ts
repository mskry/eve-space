import { toCacheKey, type EntryKey, type QueryMeta, type UseQueryEntry } from '@pinia/colada'
import type { PersistedQueryCache as ColadaPersistedQueryCache } from '@pinia/colada-plugin-cache-persister'
import {
  ESI_QUERY_RETENTION_MS,
  isEsiPersistenceCoherent,
  isEsiPersistenceEligible,
  type EsiPersistence,
} from '@eve-space/platform-module-nuxt/runtime'
import type { CacheAdmissionContext } from '../queries/auth'
import { hasExactKeys, isExactRecord, isRecord } from './shape'

const PERSISTED_CACHE_VERSION = 1

export const PERSISTED_ESI_QUERY_CACHE_KEY = 'eve-space-esi-query-cache'
export const PERSISTED_ESI_QUERY_CACHE_RETENTION_MS = ESI_QUERY_RETENTION_MS
export const PERSISTED_ESI_QUERY_CACHE_MAX_BYTES = 4 * 1024 * 1024
export const PERSISTED_ESI_QUERY_CACHE_MAX_ENTRIES = 512
export const PERSISTED_ESI_QUERY_CACHE_MAX_ENTRIES_PER_PARTITION = 128

export type PersistedQueryTuple = [data: unknown, error: null, when: number, meta: QueryMeta]
export type PersistedQueryCache = Record<string, PersistedQueryTuple>

export interface EsiQueryCacheEnvelope {
  readonly version: typeof PERSISTED_CACHE_VERSION
  readonly invalidationGeneration: number
  readonly public: PersistedQueryCache
  readonly characters: Record<
    string,
    {
      readonly ownerUserId: string
      readonly admissionRevision: string
      readonly cache: PersistedQueryCache
    }
  >
  readonly organizations: Record<
    string,
    {
      readonly ownerUserId: string
      readonly organizationVersion: number
      readonly admissionRevision: string
      readonly validUntil: string | null
      readonly cache: PersistedQueryCache
    }
  >
}

export type PrivateQueryInvalidationScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'character'; readonly characterId?: number }
  | { readonly kind: 'organization'; readonly admissionScope?: string }

export type CharacterPartition = EsiQueryCacheEnvelope['characters'][string]
export type OrganizationPartition = EsiQueryCacheEnvelope['organizations'][string]
export type PrivatePartition = CharacterPartition | OrganizationPartition
export type PersistableEsiQuery = Exclude<EsiPersistence, { kind: 'none' }>
export type PrivateEsiQuery = Exclude<EsiPersistence, { kind: 'none' | 'public-esi' }>

interface ParsedTuple {
  readonly key: EntryKey
  readonly meta: QueryMeta
  readonly persistence: PersistableEsiQuery
  readonly tuple: PersistedQueryTuple
}

interface EnvelopeEntry {
  readonly cache: PersistedQueryCache
  readonly keyHash: string
  readonly tuple: PersistedQueryTuple
}

interface ParseEnvelopeBudget {
  entries: number
}

type PrivateCacheLocation =
  | { readonly kind: 'character'; readonly key: string }
  | { readonly kind: 'organization'; readonly key: string }

interface EnvelopeBytePruningState {
  readonly cacheSizes: Map<PersistedQueryCache, number>
  readonly privateCacheLocations: ReadonlyMap<PersistedQueryCache, PrivateCacheLocation>
  readonly privatePartitionCounts: {
    character: number
    organization: number
  }
}

interface SerializeEnvelopeOptions {
  readonly admission: CacheAdmissionContext | null
  readonly durableGenerationVerified: boolean
  readonly generation: number
  readonly hasFailedData: (keyHash: string) => boolean
  readonly hasQuarantinedData: (keyHash: string) => boolean
  readonly isRemovalTombstoned: (keyHash: string) => boolean
  readonly now: number
  readonly priorEnvelope: EsiQueryCacheEnvelope
  readonly privatePersistenceEnabled: boolean
  readonly readOriginalSuccessTime: (keyHash: string) => number | undefined
  readonly retainedPrivateAccessOpen: boolean
  readonly verifiedUserId: string | null
}

export interface SerializedEnvelopeResult {
  readonly acceptedSuccessfulTimes: ReadonlyMap<string, number>
  readonly envelope: EsiQueryCacheEnvelope
  readonly observedKeys: ReadonlySet<string>
  readonly serialized: string
}

export function shouldPersistEsiQuery(entry: Pick<UseQueryEntry, 'key' | 'meta'>) {
  const persistence = readEsiPersistence(entry.meta)
  return !!persistence && isEsiPersistenceCoherent(entry.key, persistence)
}

export function serializePersistedEnvelope(
  cache: ColadaPersistedQueryCache,
  options: SerializeEnvelopeOptions,
): SerializedEnvelopeResult {
  const next = emptyEnvelope(options.generation)
  const observedKeys = new Set<string>()
  const acceptedSuccessfulTimes = new Map<string, number>()

  for (const [keyHash, value] of Object.entries(cache)) {
    observedKeys.add(keyHash)
    const parsed = parseTuple(keyHash, value, options.now, false)
    if (!parsed) {
      continue
    }
    const successfulAt = options.readOriginalSuccessTime(keyHash)
    if (!isRetainedSuccessTimestamp(successfulAt, options.now)) {
      continue
    }
    const tuple: PersistedQueryTuple = [parsed.tuple[0], null, successfulAt, parsed.meta]
    if (!addAdmittedTuple(next, keyHash, tuple, parsed.persistence, options)) {
      continue
    }
    acceptedSuccessfulTimes.set(keyHash, successfulAt)
  }

  mergePriorSuccessfulTuples(next, observedKeys, options)
  const serialized = serializeBoundedEnvelope(next)
  const retainedKeys = new Set(envelopeEntries(next).map(({ keyHash }) => keyHash))
  for (const keyHash of acceptedSuccessfulTimes.keys()) {
    if (!retainedKeys.has(keyHash)) {
      acceptedSuccessfulTimes.delete(keyHash)
    }
  }
  return {
    acceptedSuccessfulTimes,
    envelope: next,
    observedKeys,
    serialized,
  }
}

export function parsePersistedEnvelope(stored: string, now: number) {
  if (serializedEnvelopeExceedsByteLimit(stored)) {
    throw new TypeError('Persisted ESI cache envelope exceeds the size limit.')
  }
  const value: unknown = JSON.parse(stored)
  if (
    !isExactRecord(value, [
      'version',
      'invalidationGeneration',
      'public',
      'characters',
      'organizations',
    ])
  ) {
    throw new TypeError('Persisted ESI cache envelope is invalid.')
  }
  if (value.version !== PERSISTED_CACHE_VERSION) {
    throw new TypeError('Persisted ESI cache envelope version is unsupported.')
  }
  if (!isInvalidationGeneration(value.invalidationGeneration)) {
    throw new TypeError('Persisted ESI cache invalidation generation is invalid.')
  }

  const budget = { entries: 0 }
  const publicCache = parsePartitionCache(
    value.public,
    now,
    (persistence) => persistence.kind === 'public-esi',
    budget,
  )

  if (!isRecord(value.characters) || !isRecord(value.organizations)) {
    throw new TypeError('Persisted ESI cache partitions are invalid.')
  }
  const characters = parseCharacterPartitions(value.characters, now, budget)
  const organizations = parseOrganizationPartitions(value.organizations, now, budget)
  const pruned = publicCache.pruned || characters.pruned || organizations.pruned

  return {
    envelope: {
      characters: characters.partitions,
      invalidationGeneration: value.invalidationGeneration,
      organizations: organizations.partitions,
      public: publicCache.cache,
      version: PERSISTED_CACHE_VERSION,
    } satisfies EsiQueryCacheEnvelope,
    pruned,
  }
}

export function parseCacheAdmissionContext(value: unknown): CacheAdmissionContext | null {
  if (!isRecord(value) || !isNonemptyString(value.userId) || !Array.isArray(value.characters)) {
    return null
  }
  const characterIds = new Set<number>()
  const characters: Array<CacheAdmissionContext['characters'][number]> = []
  for (const candidate of value.characters) {
    if (
      !isRecord(candidate) ||
      !isPositiveInteger(candidate.characterId) ||
      characterIds.has(candidate.characterId) ||
      (candidate.admissionRevision !== null && !isNonemptyString(candidate.admissionRevision))
    ) {
      return null
    }
    characterIds.add(candidate.characterId)
    characters.push({
      admissionRevision: candidate.admissionRevision,
      characterId: candidate.characterId,
    })
  }

  let organization: CacheAdmissionContext['organization'] = null
  if (value.organization !== null) {
    const candidate = value.organization
    if (
      !isRecord(candidate) ||
      !isPositiveInteger(candidate.organizationVersion) ||
      !isNonemptyString(candidate.admissionRevision) ||
      !isNullableIsoTimestamp(candidate.validUntil) ||
      !Array.isArray(candidate.admissionScopes)
    ) {
      return null
    }
    const admissionScopes = candidate.admissionScopes.filter(isNonemptyString)
    if (
      admissionScopes.length !== candidate.admissionScopes.length ||
      new Set(admissionScopes).size !== admissionScopes.length
    ) {
      return null
    }
    organization = {
      admissionRevision: candidate.admissionRevision,
      admissionScopes,
      organizationVersion: candidate.organizationVersion,
      validUntil: candidate.validUntil,
    }
  }
  return { characters, organization, userId: value.userId }
}

export function readEsiPersistence(meta: QueryMeta) {
  const value: unknown = meta?.esiPersistence
  return isEsiPersistenceEligible(value) ? value : null
}

export function partitionMatchesAdmission(
  partition: PrivatePartition,
  persistence: PrivateEsiQuery,
  admission: CacheAdmissionContext,
  now: number,
) {
  if (partition.ownerUserId !== admission.userId) {
    return false
  }
  if (persistence.kind === 'character-esi') {
    if (!isCharacterPartition(partition)) {
      return false
    }
    return admission.characters.some(
      (character) =>
        character.characterId === persistence.characterId &&
        character.admissionRevision === partition.admissionRevision,
    )
  }
  if (!isOrganizationPartition(partition)) {
    return false
  }
  const organization = admission.organization
  return (
    !!organization &&
    organization.organizationVersion === partition.organizationVersion &&
    organization.admissionRevision === partition.admissionRevision &&
    organization.validUntil === partition.validUntil &&
    organization.admissionScopes.includes(persistence.admissionScope) &&
    !isExpired(organization.validUntil, now)
  )
}

export function combineInvalidationScopes(scopes: readonly PrivateQueryInvalidationScope[]) {
  const uniqueScopes = new Map<string, PrivateQueryInvalidationScope>()
  for (const scope of scopes) {
    uniqueScopes.set(JSON.stringify(scope), scope)
  }
  const unique = [...uniqueScopes.values()]
  if (unique.length === 0) {
    return null
  }
  if (unique.length === 1) {
    return unique[0]!
  }
  if (unique.every((scope) => scope.kind === 'character')) {
    return { kind: 'character' } as const
  }
  if (unique.every((scope) => scope.kind === 'organization')) {
    return { kind: 'organization' } as const
  }
  return { kind: 'all' } as const
}

export function invalidationScopeForPersistence(
  persistence: PrivateEsiQuery,
): PrivateQueryInvalidationScope {
  return persistence.kind === 'character-esi'
    ? { characterId: persistence.characterId, kind: 'character' }
    : { admissionScope: persistence.admissionScope, kind: 'organization' }
}

export function invalidationScopeMatchesPersistence(
  scope: PrivateQueryInvalidationScope,
  persistence: PrivateEsiQuery,
) {
  if (scope.kind === 'all') {
    return true
  }
  if (scope.kind === 'character') {
    return (
      persistence.kind === 'character-esi' &&
      (scope.characterId === undefined || scope.characterId === persistence.characterId)
    )
  }
  return (
    persistence.kind === 'organization-esi' &&
    (scope.admissionScope === undefined || scope.admissionScope === persistence.admissionScope)
  )
}

export function forEachPrivateTuple(
  envelope: EsiQueryCacheEnvelope,
  visitor: (
    keyHash: string,
    tuple: PersistedQueryTuple,
    partition: PrivatePartition,
    persistence: PrivateEsiQuery,
  ) => void,
) {
  for (const [characterId, partition] of Object.entries(envelope.characters)) {
    const persistence = { characterId: Number(characterId), kind: 'character-esi' } as const
    for (const [keyHash, tuple] of Object.entries(partition.cache)) {
      visitor(keyHash, tuple, partition, persistence)
    }
  }
  for (const [admissionScope, partition] of Object.entries(envelope.organizations)) {
    const persistence = { admissionScope, kind: 'organization-esi' } as const
    for (const [keyHash, tuple] of Object.entries(partition.cache)) {
      visitor(keyHash, tuple, partition, persistence)
    }
  }
}

export function removeTupleFromEnvelope(envelope: EsiQueryCacheEnvelope, keyHash: string) {
  let changed = Object.hasOwn(envelope.public, keyHash)
  delete envelope.public[keyHash]
  for (const [characterId, partition] of Object.entries(envelope.characters)) {
    changed = Object.hasOwn(partition.cache, keyHash) || changed
    delete partition.cache[keyHash]
    if (Object.keys(partition.cache).length === 0) {
      delete envelope.characters[characterId]
    }
  }
  for (const [scope, partition] of Object.entries(envelope.organizations)) {
    changed = Object.hasOwn(partition.cache, keyHash) || changed
    delete partition.cache[keyHash]
    if (Object.keys(partition.cache).length === 0) {
      delete envelope.organizations[scope]
    }
  }
  return changed
}

export function removeEnvelopePartitions(
  envelope: EsiQueryCacheEnvelope,
  scope: PrivateQueryInvalidationScope,
) {
  if (scope.kind === 'all') {
    removePartitions(envelope.characters)
    removePartitions(envelope.organizations)
    return
  }
  if (scope.kind === 'character') {
    removePartitions(envelope.characters, scope.characterId?.toString())
    return
  }
  removePartitions(envelope.organizations, scope.admissionScope)
}

export function emptyEnvelope(generation = 0): EsiQueryCacheEnvelope {
  return {
    characters: {},
    invalidationGeneration: generation,
    organizations: {},
    public: createCache(),
    version: PERSISTED_CACHE_VERSION,
  }
}

export function createCache(): PersistedQueryCache {
  return Object.create(null) as PersistedQueryCache
}

export function isExpired(validUntil: string | null, now: number) {
  return validUntil !== null && Date.parse(validUntil) <= now
}

export function isRetainedSuccessTimestamp(value: unknown, now: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value <= now &&
    value > now - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS
  )
}

export function readSerializedEnvelopeGeneration(value: string | null) {
  if (value === null || serializedEnvelopeExceedsByteLimit(value)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) && isInvalidationGeneration(parsed.invalidationGeneration)
      ? parsed.invalidationGeneration
      : null
  } catch {
    return null
  }
}

export function toPublicOnlySerializedEnvelope(
  value: string | null,
  generation: number,
  now: number,
) {
  if (value === null) {
    return null
  }
  if (serializedEnvelopeExceedsByteLimit(value)) {
    return null
  }
  try {
    const parsed = parsePersistedEnvelope(value, now).envelope
    return serializeBoundedEnvelope({
      characters: {},
      invalidationGeneration: generation,
      organizations: {},
      public: parsed.public,
      version: parsed.version,
    })
  } catch {
    return null
  }
}

export function mergePublicSerializedEnvelope(
  candidate: EsiQueryCacheEnvelope,
  storedValue: string | null,
  generation: number,
  now: number,
) {
  let retainedPrivate = emptyEnvelope(generation)
  if (storedValue !== null) {
    try {
      const stored = parsePersistedEnvelope(storedValue, now).envelope
      if (stored.invalidationGeneration === generation) {
        retainedPrivate = stored
      }
    } catch {
      retainedPrivate = emptyEnvelope(generation)
    }
  }
  const merged = {
    ...retainedPrivate,
    invalidationGeneration: generation,
    public: candidate.public,
    version: PERSISTED_CACHE_VERSION,
  } satisfies EsiQueryCacheEnvelope
  return serializeBoundedEnvelope(merged)
}

export function invalidateSerializedEnvelope(
  storedValue: string,
  currentGeneration: number,
  generation: number,
  scope: PrivateQueryInvalidationScope,
  now: number,
) {
  try {
    const stored = parsePersistedEnvelope(storedValue, now).envelope
    if (stored.invalidationGeneration !== currentGeneration) {
      return serializeBoundedEnvelope({
        ...stored,
        characters: {},
        invalidationGeneration: generation,
        organizations: {},
      } satisfies EsiQueryCacheEnvelope)
    }
    removeEnvelopePartitions(stored, scope)
    return serializeBoundedEnvelope({ ...stored, invalidationGeneration: generation })
  } catch {
    return null
  }
}

function parseCharacterPartitions(
  value: Record<string, unknown>,
  now: number,
  budget: ParseEnvelopeBudget,
) {
  const partitions: EsiQueryCacheEnvelope['characters'] = {}
  let pruned = false
  for (const [characterIdKey, candidate] of Object.entries(value)) {
    const parsed = parseCharacterPartition(characterIdKey, candidate, now, budget)
    pruned ||= parsed.pruned
    if (parsed.partition) {
      partitions[characterIdKey] = parsed.partition
    }
  }
  return { partitions, pruned }
}

function parseCharacterPartition(
  characterIdKey: string,
  candidate: unknown,
  now: number,
  budget: ParseEnvelopeBudget,
) {
  const characterId = Number(characterIdKey)
  if (!isPositiveInteger(characterId) || String(characterId) !== characterIdKey) {
    throw new TypeError('Persisted character cache identity is invalid.')
  }
  if (!isExactRecord(candidate, ['ownerUserId', 'admissionRevision', 'cache'])) {
    throw new TypeError('Persisted character cache partition is invalid.')
  }
  if (!isNonemptyString(candidate.ownerUserId) || !isNonemptyString(candidate.admissionRevision)) {
    throw new TypeError('Persisted character cache admission binding is invalid.')
  }
  const parsed = parsePartitionCache(
    candidate.cache,
    now,
    (persistence) =>
      persistence.kind === 'character-esi' && persistence.characterId === characterId,
    budget,
  )
  if (Object.keys(parsed.cache).length === 0) {
    return { partition: null, pruned: true }
  }
  return {
    partition: {
      admissionRevision: candidate.admissionRevision,
      cache: parsed.cache,
      ownerUserId: candidate.ownerUserId,
    },
    pruned: parsed.pruned,
  }
}

function parseOrganizationPartitions(
  value: Record<string, unknown>,
  now: number,
  budget: ParseEnvelopeBudget,
) {
  const partitions: EsiQueryCacheEnvelope['organizations'] = {}
  let pruned = false
  for (const [admissionScope, candidate] of Object.entries(value)) {
    const parsed = parseOrganizationPartition(admissionScope, candidate, now, budget)
    pruned ||= parsed.pruned
    if (parsed.partition) {
      partitions[admissionScope] = parsed.partition
    }
  }
  return { partitions, pruned }
}

function parseOrganizationPartition(
  admissionScope: string,
  candidate: unknown,
  now: number,
  budget: ParseEnvelopeBudget,
) {
  if (admissionScope.length === 0) {
    throw new TypeError('Persisted organization cache scope is invalid.')
  }
  if (
    !isExactRecord(candidate, [
      'ownerUserId',
      'organizationVersion',
      'admissionRevision',
      'validUntil',
      'cache',
    ])
  ) {
    throw new TypeError('Persisted organization cache partition is invalid.')
  }
  if (
    !isNonemptyString(candidate.ownerUserId) ||
    !isPositiveInteger(candidate.organizationVersion) ||
    !isNonemptyString(candidate.admissionRevision) ||
    !isNullableIsoTimestamp(candidate.validUntil)
  ) {
    throw new TypeError('Persisted organization cache admission binding is invalid.')
  }
  const parsed = parsePartitionCache(
    candidate.cache,
    now,
    (persistence) =>
      persistence.kind === 'organization-esi' && persistence.admissionScope === admissionScope,
    budget,
  )
  if (Object.keys(parsed.cache).length === 0) {
    return { partition: null, pruned: true }
  }
  return {
    partition: {
      admissionRevision: candidate.admissionRevision,
      cache: parsed.cache,
      organizationVersion: candidate.organizationVersion,
      ownerUserId: candidate.ownerUserId,
      validUntil: candidate.validUntil,
    },
    pruned: parsed.pruned,
  }
}

function removePartitions(partitions: Record<string, unknown>, key?: string) {
  if (key !== undefined) {
    delete partitions[key]
    return
  }
  for (const partitionKey of Object.keys(partitions)) {
    delete partitions[partitionKey]
  }
}

function mergePriorSuccessfulTuples(
  next: EsiQueryCacheEnvelope,
  observed: ReadonlySet<string>,
  options: SerializeEnvelopeOptions,
) {
  forEachEnvelopeTuple(options.priorEnvelope, (keyHash, tuple, partition, persistence) => {
    if (observed.has(keyHash) || options.isRemovalTombstoned(keyHash)) {
      return
    }
    if (tuple[2] <= options.now - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS) {
      return
    }
    if (persistence.kind === 'public-esi') {
      if (options.hasFailedData(keyHash)) {
        addTuple(next, keyHash, tuple, partition, persistence)
      }
      return
    }
    if (!options.durableGenerationVerified || !options.privatePersistenceEnabled || !partition) {
      return
    }
    if (!options.admission) {
      if (!options.verifiedUserId || partition.ownerUserId === options.verifiedUserId) {
        addTuple(next, keyHash, tuple, partition, persistence)
      }
      return
    }
    if (
      partitionMatchesAdmission(partition, persistence, options.admission, options.now) &&
      (options.hasFailedData(keyHash) || options.hasQuarantinedData(keyHash))
    ) {
      addTuple(next, keyHash, tuple, partition, persistence)
    }
  })
}

function addAdmittedTuple(
  envelope: EsiQueryCacheEnvelope,
  keyHash: string,
  tuple: PersistedQueryTuple,
  persistence: PersistableEsiQuery,
  options: SerializeEnvelopeOptions,
) {
  if (persistence.kind === 'public-esi') {
    envelope.public[keyHash] = tuple
    return true
  }
  const admission = options.admission
  if (
    !options.retainedPrivateAccessOpen ||
    !options.durableGenerationVerified ||
    !options.privatePersistenceEnabled ||
    !admission
  ) {
    return false
  }
  if (persistence.kind === 'character-esi') {
    const character = admission.characters.find(
      (candidate) => candidate.characterId === persistence.characterId,
    )
    if (!character?.admissionRevision) {
      return false
    }
    const partition = (envelope.characters[String(persistence.characterId)] ??= {
      admissionRevision: character.admissionRevision,
      cache: createCache(),
      ownerUserId: admission.userId,
    })
    partition.cache[keyHash] = tuple
    return true
  }
  const organization = admission.organization
  if (
    !organization ||
    !organization.admissionScopes.includes(persistence.admissionScope) ||
    isExpired(organization.validUntil, options.now)
  ) {
    return false
  }
  const partition = (envelope.organizations[persistence.admissionScope] ??= {
    admissionRevision: organization.admissionRevision,
    cache: createCache(),
    organizationVersion: organization.organizationVersion,
    ownerUserId: admission.userId,
    validUntil: organization.validUntil,
  })
  partition.cache[keyHash] = tuple
  return true
}

function addTuple(
  envelope: EsiQueryCacheEnvelope,
  keyHash: string,
  tuple: PersistedQueryTuple,
  partition: PrivatePartition | null,
  persistence: PersistableEsiQuery,
) {
  if (persistence.kind === 'public-esi') {
    envelope.public[keyHash] = tuple
  } else if (persistence.kind === 'character-esi' && isCharacterPartition(partition)) {
    const target = (envelope.characters[String(persistence.characterId)] ??= {
      admissionRevision: partition.admissionRevision,
      cache: createCache(),
      ownerUserId: partition.ownerUserId,
    })
    target.cache[keyHash] = tuple
  } else if (persistence.kind === 'organization-esi' && isOrganizationPartition(partition)) {
    const target = (envelope.organizations[persistence.admissionScope] ??= {
      admissionRevision: partition.admissionRevision,
      cache: createCache(),
      organizationVersion: partition.organizationVersion,
      ownerUserId: partition.ownerUserId,
      validUntil: partition.validUntil,
    })
    target.cache[keyHash] = tuple
  }
}

function forEachEnvelopeTuple(
  envelope: EsiQueryCacheEnvelope,
  visitor: (
    keyHash: string,
    tuple: PersistedQueryTuple,
    partition: PrivatePartition | null,
    persistence: PersistableEsiQuery,
  ) => void,
) {
  for (const [keyHash, tuple] of Object.entries(envelope.public)) {
    visitor(keyHash, tuple, null, { kind: 'public-esi' })
  }
  forEachPrivateTuple(envelope, visitor)
}

export function serializeBoundedEnvelope(envelope: EsiQueryCacheEnvelope) {
  pruneEnvelopeEntryCounts(envelope)
  let serialized = JSON.stringify(envelope)
  if (!serializedEnvelopeExceedsByteLimit(serialized)) {
    return serialized
  }

  pruneEnvelopeBytes(envelope, utf8ByteLength(serialized))
  removeEmptyPrivatePartitions(envelope)
  serialized = JSON.stringify(envelope)
  if (serializedEnvelopeExceedsByteLimit(serialized)) {
    throw new TypeError('Persisted ESI cache envelope could not be bounded.')
  }
  return serialized
}

function pruneEnvelopeBytes(envelope: EsiQueryCacheEnvelope, serializedBytes: number) {
  const state: EnvelopeBytePruningState = {
    cacheSizes: new Map(
      envelopeCaches(envelope).map((cache) => [cache, Object.keys(cache).length]),
    ),
    privateCacheLocations: locatePrivateCaches(envelope),
    privatePartitionCounts: {
      character: Object.keys(envelope.characters).length,
      organization: Object.keys(envelope.organizations).length,
    },
  }
  const oldestEntries = envelopeEntries(envelope).toSorted(compareOldestEnvelopeEntry)
  for (const entry of oldestEntries) {
    if (serializedBytes <= PERSISTED_ESI_QUERY_CACHE_MAX_BYTES) {
      break
    }
    serializedBytes -= removeEnvelopeEntry(envelope, entry, state)
  }
}

function removeEnvelopeEntry(
  envelope: EsiQueryCacheEnvelope,
  entry: EnvelopeEntry,
  state: EnvelopeBytePruningState,
) {
  const cacheSize = state.cacheSizes.get(entry.cache) ?? 0
  state.cacheSizes.set(entry.cache, cacheSize - 1)
  const location = state.privateCacheLocations.get(entry.cache)
  if (cacheSize === 1 && location) {
    return removePrivateEnvelopePartition(envelope, location, state.privatePartitionCounts)
  }
  delete entry.cache[entry.keyHash]
  return serializedEnvelopeEntryBytes(entry) + (cacheSize > 1 ? 1 : 0)
}

function removePrivateEnvelopePartition(
  envelope: EsiQueryCacheEnvelope,
  location: PrivateCacheLocation,
  partitionCounts: EnvelopeBytePruningState['privatePartitionCounts'],
) {
  if (location.kind === 'character') {
    const partition = envelope.characters[location.key]!
    const removedBytes =
      serializedEnvelopePartitionBytes(location.key, partition) +
      (partitionCounts.character > 1 ? 1 : 0)
    delete envelope.characters[location.key]
    partitionCounts.character -= 1
    return removedBytes
  }
  const partition = envelope.organizations[location.key]!
  const removedBytes =
    serializedEnvelopePartitionBytes(location.key, partition) +
    (partitionCounts.organization > 1 ? 1 : 0)
  delete envelope.organizations[location.key]
  partitionCounts.organization -= 1
  return removedBytes
}

function pruneEnvelopeEntryCounts(envelope: EsiQueryCacheEnvelope) {
  for (const cache of envelopeCaches(envelope)) {
    const entries = cacheEntries(cache).toSorted(compareNewestEnvelopeEntry)
    for (const entry of entries.slice(PERSISTED_ESI_QUERY_CACHE_MAX_ENTRIES_PER_PARTITION)) {
      delete entry.cache[entry.keyHash]
    }
  }

  const entries = envelopeEntries(envelope).toSorted(compareNewestEnvelopeEntry)
  for (const entry of entries.slice(PERSISTED_ESI_QUERY_CACHE_MAX_ENTRIES)) {
    delete entry.cache[entry.keyHash]
  }
  removeEmptyPrivatePartitions(envelope)
}

function envelopeEntries(envelope: EsiQueryCacheEnvelope) {
  return envelopeCaches(envelope).flatMap(cacheEntries)
}

function envelopeCaches(envelope: EsiQueryCacheEnvelope) {
  return [
    envelope.public,
    ...Object.values(envelope.characters).map(({ cache }) => cache),
    ...Object.values(envelope.organizations).map(({ cache }) => cache),
  ]
}

function cacheEntries(cache: PersistedQueryCache): EnvelopeEntry[] {
  return Object.entries(cache).map(([keyHash, tuple]) => ({ cache, keyHash, tuple }))
}

function compareNewestEnvelopeEntry(left: EnvelopeEntry, right: EnvelopeEntry) {
  const timestampDifference = right.tuple[2] - left.tuple[2]
  if (timestampDifference !== 0) {
    return timestampDifference
  }
  if (left.keyHash < right.keyHash) {
    return -1
  }
  if (left.keyHash > right.keyHash) {
    return 1
  }
  return 0
}

function compareOldestEnvelopeEntry(left: EnvelopeEntry, right: EnvelopeEntry) {
  const timestampDifference = left.tuple[2] - right.tuple[2]
  if (timestampDifference !== 0) {
    return timestampDifference
  }
  if (left.keyHash > right.keyHash) {
    return -1
  }
  if (left.keyHash < right.keyHash) {
    return 1
  }
  return 0
}

function serializedEnvelopeEntryBytes(entry: EnvelopeEntry) {
  return utf8ByteLength(JSON.stringify({ [entry.keyHash]: entry.tuple })) - 2
}

function serializedEnvelopePartitionBytes(key: string, partition: PrivatePartition) {
  return utf8ByteLength(JSON.stringify({ [key]: partition })) - 2
}

function locatePrivateCaches(envelope: EsiQueryCacheEnvelope) {
  const locations = new Map<PersistedQueryCache, PrivateCacheLocation>()
  for (const [key, partition] of Object.entries(envelope.characters)) {
    locations.set(partition.cache, { key, kind: 'character' })
  }
  for (const [key, partition] of Object.entries(envelope.organizations)) {
    locations.set(partition.cache, { key, kind: 'organization' })
  }
  return locations
}

function removeEmptyPrivatePartitions(envelope: EsiQueryCacheEnvelope) {
  for (const [characterId, partition] of Object.entries(envelope.characters)) {
    if (Object.keys(partition.cache).length === 0) {
      delete envelope.characters[characterId]
    }
  }
  for (const [admissionScope, partition] of Object.entries(envelope.organizations)) {
    if (Object.keys(partition.cache).length === 0) {
      delete envelope.organizations[admissionScope]
    }
  }
}

function serializedEnvelopeExceedsByteLimit(serialized: string) {
  return (
    serialized.length > PERSISTED_ESI_QUERY_CACHE_MAX_BYTES ||
    utf8ByteLength(serialized) > PERSISTED_ESI_QUERY_CACHE_MAX_BYTES
  )
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function parsePartitionCache(
  value: unknown,
  now: number,
  accepts: (persistence: PersistableEsiQuery) => boolean,
  budget: ParseEnvelopeBudget,
) {
  if (!isRecord(value)) {
    throw new TypeError('Persisted ESI query cache is invalid.')
  }
  const entries = Object.entries(value)
  if (entries.length > PERSISTED_ESI_QUERY_CACHE_MAX_ENTRIES_PER_PARTITION) {
    throw new TypeError('Persisted ESI query cache exceeds the partition entry limit.')
  }
  budget.entries += entries.length
  if (budget.entries > PERSISTED_ESI_QUERY_CACHE_MAX_ENTRIES) {
    throw new TypeError('Persisted ESI cache envelope exceeds the total entry limit.')
  }
  const cache = createCache()
  let pruned = false
  for (const [keyHash, tuple] of entries) {
    const parsed = parseTuple(keyHash, tuple, now, true)
    if (!parsed || !accepts(parsed.persistence)) {
      throw new TypeError('Persisted ESI query cache entry is invalid.')
    }
    if (parsed.tuple[2] <= now - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS) {
      pruned = true
      continue
    }
    cache[keyHash] = parsed.tuple
  }
  return { cache, pruned }
}

function parseTuple(keyHash: string, value: unknown, now: number, strict: boolean) {
  try {
    if (!Array.isArray(value) || value.length !== 4 || value[1] !== null) {
      throw new TypeError('Persisted ESI query tuple is invalid.')
    }
    if (
      typeof value[2] !== 'number' ||
      !Number.isSafeInteger(value[2]) ||
      value[2] <= 0 ||
      value[2] > now
    ) {
      throw new TypeError('Persisted ESI query timestamp is invalid.')
    }
    if (!isJsonDto(value[0])) {
      throw new TypeError('Persisted ESI query data is invalid.')
    }
    const keyValue: unknown = JSON.parse(keyHash)
    if (!Array.isArray(keyValue) || keyValue.length === 0 || toCacheKey(keyValue) !== keyHash) {
      throw new TypeError('Persisted ESI query identity is invalid.')
    }
    const meta = parsePersistedQueryMeta(value[3])
    const persistence = readEsiPersistence(meta)
    if (!persistence || !isEsiPersistenceCoherent(keyValue, persistence)) {
      throw new TypeError('Persisted ESI query declaration is incoherent.')
    }
    return {
      key: keyValue,
      meta,
      persistence,
      tuple: [value[0], null, value[2], meta],
    } satisfies ParsedTuple
  } catch (error) {
    if (strict) {
      throw error
    }
    return null
  }
}

function parsePersistedQueryMeta(value: unknown): QueryMeta {
  if (!isRecord(value)) {
    throw new TypeError('Persisted ESI query metadata is invalid.')
  }
  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'esiPersistence' && key !== 'globalErrorMessage')) {
    throw new TypeError('Persisted ESI query metadata contains unsupported fields.')
  }
  const persistence = parsePersistableEsiPersistence(value.esiPersistence)
  if (!persistence) {
    throw new TypeError('Persisted ESI query declaration is invalid.')
  }
  if (value.globalErrorMessage !== undefined && typeof value.globalErrorMessage !== 'string') {
    throw new TypeError('Persisted ESI query error metadata is invalid.')
  }
  return {
    esiPersistence: persistence,
    ...(typeof value.globalErrorMessage === 'string' && {
      globalErrorMessage: value.globalErrorMessage,
    }),
  }
}

function parsePersistableEsiPersistence(value: unknown): PersistableEsiQuery | null {
  if (!isRecord(value) || !isNonemptyString(value.kind)) {
    return null
  }
  if (value.kind === 'public-esi' && hasExactKeys(value, ['kind'])) {
    return { kind: 'public-esi' }
  }
  if (
    value.kind === 'character-esi' &&
    hasExactKeys(value, ['kind', 'characterId']) &&
    isPositiveInteger(value.characterId)
  ) {
    return { characterId: value.characterId, kind: 'character-esi' }
  }
  if (
    value.kind === 'organization-esi' &&
    hasExactKeys(value, ['kind', 'admissionScope']) &&
    isNonemptyString(value.admissionScope)
  ) {
    return { admissionScope: value.admissionScope, kind: 'organization-esi' }
  }
  return null
}

function isCharacterPartition(value: PrivatePartition | null): value is CharacterPartition {
  return !!value && !('organizationVersion' in value)
}

function isOrganizationPartition(value: PrivatePartition | null): value is OrganizationPartition {
  return !!value && 'organizationVersion' in value
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  if (value === null) {
    return true
  }
  if (typeof value !== 'string') {
    return false
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isJsonDto(value: unknown) {
  const pending = [value]
  const visited = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean' ||
      (typeof current === 'number' && Number.isFinite(current))
    ) {
      continue
    }
    if (typeof current !== 'object' || visited.has(current)) {
      return false
    }
    const prototype = Object.getPrototypeOf(current)
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      return false
    }
    visited.add(current)
    pending.push(...(Array.isArray(current) ? current : Object.values(current)))
  }
  return true
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function isInvalidationGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
