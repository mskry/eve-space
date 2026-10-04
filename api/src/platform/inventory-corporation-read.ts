import type {
  PlatformInventoryProvider,
  PlatformInventoryRead,
  PlatformInventoryView,
  PlatformInventoryCoverage,
} from '@eve-space/platform-module-contract/inventory'
import {
  corporationInventoryEvidenceAdmission,
  type CorporationInventoryBinding,
} from './inventory-admission.js'
import {
  assertInventoryCursorView,
  encodeInventoryCursor,
  InventoryRestartError,
  type InventoryCursor,
} from './inventory-cursor.js'

const coverageWindow = (
  binding: CorporationInventoryBinding,
  read: PlatformInventoryRead,
  cursor: InventoryCursor | null,
) => {
  const position = cursor ? Number(cursor.position) : 0
  if (!Number.isSafeInteger(position) || position < 0) throw new InventoryRestartError()
  return binding.subjects
    .toSorted((a, b) => a.characterId - b.characterId)
    .filter((subject) => subject.characterId > position)
    .slice(0, read.first)
}

const mergeCoverage = (
  window: CorporationInventoryBinding['subjects'],
  rows: readonly PlatformInventoryCoverage[],
) =>
  window.map((subject): PlatformInventoryCoverage => {
    if (!subject.evidenceReadable)
      return {
        characterId: subject.characterId,
        characterName: subject.characterName,
        state: subject.coverage ?? 'unavailable',
        source: null,
      }
    const row = rows.find((candidate) => candidate.characterId === subject.characterId)
    if (!row) throw new InventoryRestartError()
    return row
  })

export const readCorporationInventoryPage = async (
  binding: CorporationInventoryBinding,
  provider: PlatformInventoryProvider,
  read: PlatformInventoryRead,
  cursor: InventoryCursor | null,
): Promise<PlatformInventoryView<'corporation'>> => {
  const window = read.kind === 'coverage' ? coverageWindow(binding, read, cursor) : []
  const evidenceCount = window.filter((subject) => subject.evidenceReadable).length
  const providerRead: PlatformInventoryRead = {
    ...read,
    first: read.kind === 'coverage' ? Math.max(1, evidenceCount) : read.first,
    after: cursor?.provider ?? undefined,
  }
  const value = await provider(corporationInventoryEvidenceAdmission(binding), providerRead)
  assertInventoryCursorView(cursor, value.fingerprint)
  const counts = { ...value.coverageCounts }
  const gaps = binding.subjects.filter((subject) => !subject.evidenceReadable)
  for (const gap of gaps) counts[gap.coverage ?? 'unavailable'] += 1
  const wrap = <Row>(connection: {
    rows: readonly Row[]
    endCursor: string | null
    hasNextPage: boolean
  }) => ({
    ...connection,
    endCursor: encodeInventoryCursor(
      read,
      binding.fingerprint,
      value.fingerprint,
      connection.endCursor ? 'provider' : undefined,
      connection.endCursor,
    ),
  })
  const coverage =
    read.kind === 'coverage'
      ? {
          rows: mergeCoverage(window, value.coverage.rows),
          hasNextPage: binding.subjects.some(
            (subject) => subject.characterId > (window.at(-1)?.characterId ?? Infinity),
          ),
          endCursor: encodeInventoryCursor(
            read,
            binding.fingerprint,
            value.fingerprint,
            window.at(-1)?.characterId.toString(),
            evidenceCount > 0 ? value.coverage.endCursor : (cursor?.provider ?? null),
          ),
        }
      : { rows: [], endCursor: null, hasNextPage: false }
  return {
    ...value,
    expectedSubjects: binding.subjects.length,
    sourcesComplete: value.sourcesComplete && gaps.length === 0,
    coverageCounts: counts,
    groups: wrap(value.groups),
    holders: wrap(value.holders),
    coverage,
  }
}
