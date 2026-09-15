import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'
import { getStaleEsiMetadata, type StaleEsiMetadata } from '../utils/esi-freshness'
import { ApiQueryError } from '../utils/query-error'
import { isRetainedSuccessTimestamp, PERSISTED_ESI_QUERY_CACHE_RETENTION_MS } from './envelope'

type QueryPersistenceProvenance =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'restored' }
  | {
      readonly kind: 'restored-refresh-failed'
      readonly retryAt?: string
      readonly refreshFailureCode?: string
      readonly refreshFailureStatus?: number
    }
  | {
      readonly kind: 'server-stale'
      readonly validatedAt?: string
      readonly retryAt?: string
      readonly refreshFailureClass?: string
    }

interface EntryRecord {
  readonly provenance: QueryPersistenceProvenance
  readonly originalSuccessAt?: number
  readonly restored: boolean
  readonly local: boolean
  readonly failed: boolean
  readonly quarantined: boolean
}

interface SuccessfulEntryEvent {
  readonly keyHash: string
  readonly data: unknown
  readonly source: 'fetch' | 'ssr'
  readonly when: number
  readonly now: number
  readonly priorSuccessAt?: number
  readonly reconcileStagedRestore?: boolean
}

interface LocalWriteEvent {
  readonly keyHash: string
  readonly now: number
  readonly priorSuccessAt?: number
}

export interface QueryPersistenceEntryState {
  restored(keyHash: string, data: unknown, originalSuccessAt: number): void
  succeeded(event: SuccessfulEntryEvent): boolean
  failed(keyHash: string, error: unknown, hasData: boolean): void
  quarantine(keyHash: string): void
  localWrite(event: LocalWriteEvent): void
  removed(keyHash: string): void
  serializerMerged(acceptedSuccessfulTimes: ReadonlyMap<string, number>): void
  reset(): void
  readPresentation(keyHash: string): EsiQueryPersistencePresentation
  hasRestoredData(keyHash: string): boolean
  hasFailedData(keyHash: string): boolean
  hasQuarantinedData(keyHash: string): boolean
  readOriginalSuccessTime(keyHash: string): number | undefined
  readRetentionDeadline(keyHash: string): number | undefined
  isRemovalTombstoned(keyHash: string): boolean
}

export function createQueryPersistenceEntryState(): QueryPersistenceEntryState {
  const records = new Map<string, EntryRecord>()
  const removalTombstones = new Set<string>()

  return {
    restored(keyHash, data, originalSuccessAt) {
      records.set(keyHash, {
        provenance: provenanceForData(data, 'restored'),
        originalSuccessAt,
        restored: true,
        local: false,
        failed: false,
        quarantined: false,
      })
      removalTombstones.delete(keyHash)
    },
    succeeded(event) {
      const existing = records.get(event.keyHash)
      if (
        event.source === 'ssr' &&
        (existing?.local ||
          (existing &&
            (!event.reconcileStagedRestore || existing.provenance.kind !== 'server-stale')))
      ) {
        return false
      }

      const staleMetadata = getStaleEsiMetadata(event.data)
      const originalSuccessAt = staleMetadata
        ? staleOriginalSuccessAt(existing, event, staleMetadata)
        : freshOriginalSuccessAt(event)
      records.set(event.keyHash, {
        provenance: staleMetadata ? serverStaleProvenance(staleMetadata) : { kind: 'fresh' },
        ...(originalSuccessAt === undefined ? {} : { originalSuccessAt }),
        restored: false,
        local: false,
        failed: false,
        quarantined: false,
      })
      removalTombstones.delete(event.keyHash)
      return true
    },
    failed(keyHash, error, hasData) {
      if (!hasData) return
      const existing = records.get(keyHash)
      const provenance = existing?.provenance ?? { kind: 'fresh' as const }
      records.set(keyHash, {
        ...(existing ?? {
          provenance,
          restored: false,
          local: false,
          quarantined: false,
        }),
        provenance:
          provenance.kind === 'restored' || provenance.kind === 'restored-refresh-failed'
            ? restoredRefreshFailedProvenance(provenance, error)
            : provenance,
        failed: true,
      })
    },
    quarantine(keyHash) {
      const existing = records.get(keyHash)
      if (!existing) return
      records.set(keyHash, { ...existing, quarantined: true })
    },
    localWrite(event) {
      const existing = records.get(event.keyHash)
      const originalSuccessAt = oldestPastTimestamp(
        event.now,
        existing?.originalSuccessAt,
        event.priorSuccessAt,
      )
      records.set(event.keyHash, {
        provenance: existing?.provenance ?? { kind: 'fresh' },
        ...(originalSuccessAt === undefined ? {} : { originalSuccessAt }),
        restored: existing?.restored ?? false,
        local: true,
        failed: false,
        quarantined: false,
      })
    },
    removed(keyHash) {
      records.delete(keyHash)
      removalTombstones.add(keyHash)
    },
    serializerMerged(acceptedSuccessfulTimes) {
      for (const [keyHash, originalSuccessAt] of acceptedSuccessfulTimes) {
        const existing = records.get(keyHash)
        records.set(keyHash, {
          provenance: existing?.provenance ?? { kind: 'fresh' },
          originalSuccessAt,
          restored: existing?.restored ?? false,
          local: existing?.local ?? false,
          failed: existing?.failed ?? false,
          quarantined: existing?.quarantined ?? false,
        })
        removalTombstones.delete(keyHash)
      }
    },
    reset() {
      records.clear()
      removalTombstones.clear()
    },
    readPresentation(keyHash) {
      return presentationForRecord(records.get(keyHash))
    },
    hasRestoredData(keyHash) {
      return records.get(keyHash)?.restored ?? false
    },
    hasFailedData(keyHash) {
      return records.get(keyHash)?.failed ?? false
    },
    hasQuarantinedData(keyHash) {
      return records.get(keyHash)?.quarantined ?? false
    },
    readOriginalSuccessTime(keyHash) {
      return records.get(keyHash)?.originalSuccessAt
    },
    readRetentionDeadline(keyHash) {
      const record = records.get(keyHash)
      if (
        record?.originalSuccessAt === undefined ||
        (!record.restored && record.provenance.kind !== 'server-stale')
      ) {
        return undefined
      }
      return record.originalSuccessAt + PERSISTED_ESI_QUERY_CACHE_RETENTION_MS
    },
    isRemovalTombstoned(keyHash) {
      return removalTombstones.has(keyHash)
    },
  }
}

function provenanceForData(
  data: unknown,
  fallback: Extract<QueryPersistenceProvenance, { kind: 'restored' | 'fresh' }>['kind'],
): QueryPersistenceProvenance {
  const staleMetadata = getStaleEsiMetadata(data)
  return staleMetadata ? serverStaleProvenance(staleMetadata) : { kind: fallback }
}

function staleOriginalSuccessAt(
  existing: EntryRecord | undefined,
  event: SuccessfulEntryEvent,
  metadata: StaleEsiMetadata,
) {
  const originalSuccessAt = oldestPastTimestamp(
    event.now,
    existing?.originalSuccessAt,
    event.priorSuccessAt,
  )
  if (originalSuccessAt !== undefined) return originalSuccessAt
  if (!metadata.validatedAt) return undefined
  const validatedAt = Date.parse(metadata.validatedAt)
  return oldestPastTimestamp(event.now, validatedAt)
}

function freshOriginalSuccessAt(event: SuccessfulEntryEvent) {
  return event.source === 'ssr' && isRetainedSuccessTimestamp(event.when, event.now)
    ? event.when
    : event.now
}

function oldestPastTimestamp(now: number, ...candidates: readonly (number | undefined)[]) {
  const valid = candidates.filter(
    (candidate): candidate is number =>
      typeof candidate === 'number' && Number.isFinite(candidate) && candidate <= now,
  )
  return valid.length === 0 ? undefined : Math.min(...valid)
}

function serverStaleProvenance(metadata: StaleEsiMetadata): QueryPersistenceProvenance {
  return {
    kind: 'server-stale',
    ...(metadata.validatedAt ? { validatedAt: metadata.validatedAt } : {}),
    ...(metadata.retryAt ? { retryAt: metadata.retryAt } : {}),
    ...(metadata.refreshFailureClass ? { refreshFailureClass: metadata.refreshFailureClass } : {}),
  }
}

function restoredRefreshFailedProvenance(
  provenance: Extract<QueryPersistenceProvenance, { kind: 'restored' | 'restored-refresh-failed' }>,
  error: unknown,
): QueryPersistenceProvenance {
  const retryAt =
    normalizedRetryAt(error) ??
    (provenance.kind === 'restored-refresh-failed' ? provenance.retryAt : undefined)
  return {
    kind: 'restored-refresh-failed',
    ...(retryAt ? { retryAt } : {}),
    ...refreshFailureMetadata(error, provenance),
  }
}

function normalizedRetryAt(error: unknown) {
  if (!(error instanceof ApiQueryError) || !error.retryAt) return undefined
  return Number.isFinite(Date.parse(error.retryAt)) ? error.retryAt : undefined
}

function refreshFailureMetadata(
  error: unknown,
  provenance: Extract<QueryPersistenceProvenance, { kind: 'restored' | 'restored-refresh-failed' }>,
) {
  if (error instanceof ApiQueryError) {
    return {
      ...(error.code ? { refreshFailureCode: error.code } : {}),
      refreshFailureStatus: error.status,
    }
  }
  if (provenance.kind !== 'restored-refresh-failed') return {}
  return {
    ...(provenance.refreshFailureCode ? { refreshFailureCode: provenance.refreshFailureCode } : {}),
    ...(provenance.refreshFailureStatus
      ? { refreshFailureStatus: provenance.refreshFailureStatus }
      : {}),
  }
}

function presentationForRecord(record: EntryRecord | undefined): EsiQueryPersistencePresentation {
  if (!record) return { kind: 'fresh' }
  const originalSuccessAt =
    record.originalSuccessAt === undefined
      ? undefined
      : new Date(record.originalSuccessAt).toISOString()
  if (record.provenance.kind === 'fresh') return { kind: 'fresh', originalSuccessAt }
  if (record.provenance.kind === 'server-stale') {
    return { ...record.provenance, originalSuccessAt }
  }
  if (!originalSuccessAt) return { kind: 'fresh' }
  return { ...record.provenance, originalSuccessAt }
}
