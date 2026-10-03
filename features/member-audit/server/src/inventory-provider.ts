import {
  definePlatformInventoryProvider,
  emptyInventoryCoverageCounts,
  platformInventoryBounds,
  type PlatformAdmittedCorporationInventory,
  type PlatformCorporationInventorySubject,
  type PlatformInventoryCoverage,
  type PlatformInventoryCoverageState,
  type PlatformInventoryGroup,
  type PlatformInventoryFilters,
  type PlatformInventoryRead,
  type PlatformInventorySource,
  type PlatformInventoryView,
} from '@eve-space/platform-module-contract/inventory'
import { z } from 'zod'
import type { InventoryReadPersistence } from './inventory-persistence.js'

const latestSnapshotRetention = '9999-12-31T23:59:59.999Z'
const groupPositionSchema = z.tuple([
  z.number().int().positive(),
  z.enum(['none', 'original', 'copy']),
  z.string().max(100),
])
const cursorSchema = z.strictObject({
  fingerprint: z.string().length(64),
  query: z.string().length(64),
  position: z.string().max(256),
})
type SourceMetadata = Awaited<ReturnType<InventoryReadPersistence['readInventorySources']>>[number]
interface BoundSource {
  readonly subject: PlatformCorporationInventorySubject
  readonly metadata: SourceMetadata
  readonly coverage: PlatformInventoryCoverage
}

class MemberAssetInventoryRestartError extends Error {
  readonly code = 'INVENTORY_RESTART_REQUIRED'
  constructor() {
    super('Inventory source changed; restart the view')
  }
}

type FingerprintInput =
  | { readonly authority: string; readonly sources: readonly BoundSource[] }
  | {
      readonly kind: PlatformInventoryRead['kind']
      readonly filters: PlatformInventoryFilters
      readonly groupKey: string | null
    }

const fingerprint = async (value: FingerprintInput) => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const encodeCursor = (value: string) =>
  btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const decodeCursor = (value: string) => atob(value.replaceAll('-', '+').replaceAll('_', '/'))
const restart = (): never => {
  throw new MemberAssetInventoryRestartError()
}
const subjectAuthority = (
  admission: PlatformAdmittedCorporationInventory,
  subject: PlatformCorporationInventorySubject,
) => ({
  organizationVersion: admission.organizationVersion,
  targetUserId: subject.userId,
  managedMemberLifecycleId: subject.memberLifecycle,
  characterId: subject.characterId,
  characterLifecycleId: subject.characterLifecycle,
  authorizationGeneration: subject.authorizationGeneration,
  disclosureVersion: subject.disclosureRevision,
  sectionActivationVersion: subject.sectionActivationRevision,
  observationId: subject.observationId,
})
const characterName = (subject: PlatformCorporationInventorySubject) =>
  subject.characterName ?? `Character ${subject.characterId}`
const assertFresh = (sources: readonly BoundSource[]) => {
  if (
    sources.some(
      ({ coverage }) =>
        coverage.state === 'included-current' &&
        Date.parse(coverage.source!.freshUntil) <= Date.now(),
    )
  )
    restart()
}
const boundSource = (
  subject: PlatformCorporationInventorySubject,
  metadata: SourceMetadata,
  state: PlatformInventoryCoverageState,
  source: PlatformInventorySource | null,
): BoundSource => ({
  subject,
  metadata,
  coverage: {
    characterId: subject.characterId,
    characterName: characterName(subject),
    state,
    source,
  },
})
const bindSource = (
  subject: PlatformCorporationInventorySubject,
  metadata: SourceMetadata,
): BoundSource => {
  const collection = subject.collection
  const gap = collection?.state === 'never-collected' ? 'never-collected' : 'unavailable'
  if (
    !metadata.observationId ||
    !metadata.validatedAt ||
    !collection?.validatedAt ||
    !collection.freshUntil
  )
    return boundSource(subject, metadata, gap, null)
  if (new Date(metadata.validatedAt).toISOString() !== collection.validatedAt) restart()
  if (subject.observationId && metadata.observationId !== subject.observationId) restart()
  if (collection.state !== 'current' && collection.state !== 'stale')
    return boundSource(subject, metadata, gap, null)
  let state: PlatformInventoryCoverageState =
    collection.state === 'current' ? 'included-current' : 'included-stale'
  if (!metadata.ready) state = 'incomplete'
  return boundSource(subject, metadata, state, {
    observationId: metadata.observationId,
    observedAt: collection.validatedAt,
    validatedAt: collection.validatedAt,
    freshUntil: collection.freshUntil,
    retainedUntil: latestSnapshotRetention,
  })
}
const sourceReadable = ({ coverage }: BoundSource) =>
  coverage.state === 'included-current' || coverage.state === 'included-stale'
const queryFingerprint = (read: PlatformInventoryRead) =>
  fingerprint({
    kind: read.kind,
    filters: read.kind === 'groups' ? (read.filters ?? {}) : {},
    groupKey: read.kind === 'holders' ? read.groupKey : null,
  })
const decodePosition = (
  read: PlatformInventoryRead,
  viewFingerprint: string,
  query: string,
): string | null => {
  if (!read.after) return null
  try {
    if (read.after.length > 2048 || encodeCursor(decodeCursor(read.after)) !== read.after)
      return restart()
    const cursor = cursorSchema.parse(JSON.parse(decodeCursor(read.after)))
    if (cursor.fingerprint !== viewFingerprint || cursor.query !== query) return restart()
    if (read.kind === 'groups') groupPositionSchema.parse(JSON.parse(cursor.position))
    else if (!Number.isSafeInteger(Number(cursor.position)) || Number(cursor.position) <= 0)
      return restart()
    return cursor.position
  } catch {
    return restart()
  }
}
const encodePosition = (viewFingerprint: string, query: string, position: string | undefined) =>
  position === undefined
    ? null
    : encodeCursor(JSON.stringify({ fingerprint: viewFingerprint, query, position }))
const assertAdmission = (
  admission: PlatformAdmittedCorporationInventory,
  read: PlatformInventoryRead,
) => {
  if (
    admission.scope !== 'corporation' ||
    admission.subjects.length > platformInventoryBounds.corporationSubjects ||
    !Number.isInteger(read.first) ||
    read.first < 1 ||
    read.first > platformInventoryBounds.pageSize
  )
    throw new RangeError('Inventory read exceeds its declared scope')
  if (
    new Set(admission.subjects.map((subject) => subject.characterId)).size !==
      admission.subjects.length ||
    admission.subjects.some(
      (subject) => !subject.evidenceReadable || subject.corporationId !== admission.corporationId,
    )
  )
    throw new TypeError('Inventory requires core-bound readable subjects')
  if (read.kind === 'holders') {
    if (read.groupKey.length > 256) restart()
    groupPositionSchema.parse(JSON.parse(read.groupKey))
  }
}
const readSources = async (
  persistence: InventoryReadPersistence,
  admission: PlatformAdmittedCorporationInventory,
) => {
  const metadata = await persistence.readInventorySources({
    subjects: admission.subjects.map((subject) => subjectAuthority(admission, subject)),
  })
  const byCharacter = new Map(metadata.map((source) => [source.characterId, source]))
  if (
    byCharacter.size !== admission.subjects.length ||
    metadata.length !== admission.subjects.length
  )
    restart()
  return admission.subjects.map((subject) => {
    const source = byCharacter.get(subject.characterId)
    if (!source) return restart()
    return bindSource(subject, source)
  })
}
const groupPosition = (group: PlatformInventoryGroup | undefined) =>
  group && JSON.stringify([group.typeId, group.blueprint, group.location.key])
const coverageFor = (sources: readonly BoundSource[], conflicts: readonly number[]) => {
  const conflicting = new Set(conflicts)
  return sources
    .map(({ coverage }) =>
      conflicting.has(coverage.characterId)
        ? {
            characterId: coverage.characterId,
            characterName: coverage.characterName,
            source: coverage.source,
            state: 'conflicting-source' as const,
          }
        : coverage,
    )
    .toSorted((left, right) => left.characterId - right.characterId)
}
const coverageCountsFor = (coverage: readonly PlatformInventoryCoverage[]) => {
  const counts = emptyInventoryCoverageCounts()
  for (const row of coverage) counts[row.state] += 1
  return counts
}

export const memberAssetInventoryProvider =
  definePlatformInventoryProvider<InventoryReadPersistence>(
    ({ persistence, signal }) =>
      async (admission, read): Promise<PlatformInventoryView<'corporation'>> => {
        signal.throwIfAborted()
        assertAdmission(admission, read)
        const sources = await readSources(persistence, admission)
        assertFresh(sources)
        const viewFingerprint = await fingerprint({ authority: admission.fingerprint, sources })
        const query = await queryFingerprint(read)
        const position = decodePosition(read, viewFingerprint, query)
        signal.throwIfAborted()
        const result = await persistence.readAssetInventory({
          subjects: sources.filter(sourceReadable).map(({ subject, coverage }) =>
            Object.assign(subjectAuthority(admission, subject), {
              observationId: coverage.source!.observationId,
              stale: coverage.state === 'included-stale',
            }),
          ),
          kind: read.kind,
          first: read.first,
          after: read.kind === 'coverage' ? null : position,
          groupKey: read.kind === 'holders' ? read.groupKey : null,
          filters: read.kind === 'groups' ? { ...read.filters } : {},
        })
        signal.throwIfAborted()
        const rechecked = await readSources(persistence, admission)
        if (
          (await fingerprint({ authority: admission.fingerprint, sources: rechecked })) !==
          viewFingerprint
        )
          restart()
        assertFresh(sources)
        signal.throwIfAborted()
        const coverage = coverageFor(sources, result.conflictingCharacters)
        const byCharacter = new Map(
          sources.filter(sourceReadable).map((source) => [source.subject.characterId, source]),
        )
        const holders = result.holders.map((row) => {
          const bound = byCharacter.get(row.characterId)
          if (!bound) return restart()
          return {
            ...row,
            userId: bound.subject.userId,
            characterName: characterName(bound.subject),
            source: bound.coverage.source!,
          }
        })
        const coveragePage =
          read.kind === 'coverage'
            ? coverage
                .filter((row) => position === null || row.characterId > Number(position))
                .slice(0, read.first)
            : []
        const groups = result.groups
        return {
          version: 1,
          scope: 'corporation',
          corporationId: admission.corporationId,
          fingerprint: viewFingerprint,
          traversalComplete: true,
          sourcesComplete: coverage.every(
            (row) => row.state === 'included-current' || row.state === 'included-stale',
          ),
          expectedSubjects: sources.length,
          coverageCounts: coverageCountsFor(coverage),
          groups: {
            rows: groups,
            hasNextPage: read.kind === 'groups' && result.hasNextPage,
            endCursor: encodePosition(viewFingerprint, query, groupPosition(groups.at(-1))),
          },
          holders: {
            rows: holders,
            hasNextPage: read.kind === 'holders' && result.hasNextPage,
            endCursor: encodePosition(
              viewFingerprint,
              query,
              holders.at(-1)?.characterId.toString(),
            ),
          },
          coverage: {
            rows: coveragePage,
            hasNextPage:
              read.kind === 'coverage' &&
              coverage.some(
                (row) => row.characterId > (coveragePage.at(-1)?.characterId ?? Infinity),
              ),
            endCursor: encodePosition(
              viewFingerprint,
              query,
              coveragePage.at(-1)?.characterId.toString(),
            ),
          },
        }
      },
  )
