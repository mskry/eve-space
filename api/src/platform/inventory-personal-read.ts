import type {
  PlatformInventoryPage,
  PlatformInventoryRead,
  PlatformInventoryView,
} from '@eve-space/platform-module-contract/inventory'
import type { PersonalInventoryBinding } from '../auth/inventory-admission.js'
import { readPersonalInventorySources } from '../characters/inventory-source.js'
import {
  reducePersonalInventory,
  type PersonalInventoryReduction,
} from '../characters/inventory-reduction.js'
import { enrichInventoryItems } from '../characters/inventory-enrichment.js'
import type { CharacterAssetWindowWork } from '../characters/asset-work.js'
import { inventoryGroupMatchesFilters } from '../inventory-policy.js'
import { personalInventoryEvidenceAdmission } from './inventory-admission.js'
import {
  assertInventoryCursorView,
  encodeInventoryCursor,
  InventoryRestartError,
  type InventoryCursor,
} from './inventory-cursor.js'

export interface PersonalInventoryReadResult {
  readonly reduction: PersonalInventoryReduction
  readonly releaseDeadline: number | null
}

const emptyPage = <Row>(): PlatformInventoryPage<Row> => ({
  rows: [],
  endCursor: null,
  hasNextPage: false,
})

const page = <Row>(
  rows: readonly Row[],
  key: (row: Row) => string,
  read: PlatformInventoryRead,
  binding: PersonalInventoryBinding,
  view: string,
  cursor: InventoryCursor | null,
): PlatformInventoryPage<Row> => {
  const index = cursor ? rows.findIndex((row) => key(row) === cursor.position) : -1
  if (cursor && index < 0) throw new InventoryRestartError()
  const window = rows.slice(index + 1, index + 1 + read.first)
  return {
    rows: window,
    hasNextPage: rows.length > index + 1 + read.first,
    endCursor: encodeInventoryCursor(
      read,
      binding.fingerprint,
      view,
      window.length ? key(window.at(-1)!) : undefined,
    ),
  }
}

export const assertPersonalReductionCurrent = (value: PersonalInventoryReadResult) => {
  if (value.releaseDeadline !== null && value.releaseDeadline <= Date.now())
    throw new InventoryRestartError()
}

export const loadPersonalInventoryReduction = async (
  binding: PersonalInventoryBinding,
  work: CharacterAssetWindowWork,
): Promise<PersonalInventoryReadResult> => {
  const sources = await readPersonalInventorySources(
    personalInventoryEvidenceAdmission(binding),
    work,
  )
  const enrichment = await enrichInventoryItems(
    sources.flatMap((source) => source.items),
    work,
  )
  const deadlines = sources.flatMap((source) =>
    source.source
      ? [
          Date.parse(
            source.state === 'included-current'
              ? source.source.freshUntil
              : source.source.retainedUntil,
          ),
        ]
      : [],
  )
  return {
    reduction: reducePersonalInventory(binding, sources, enrichment),
    releaseDeadline: deadlines.length > 0 ? Math.min(...deadlines) : null,
  }
}

export const personalInventoryPage = (
  binding: PersonalInventoryBinding,
  readResult: PersonalInventoryReadResult,
  read: PlatformInventoryRead,
  cursor: InventoryCursor | null,
): PlatformInventoryView<'personal'> => {
  assertPersonalReductionCurrent(readResult)
  const value = readResult.reduction
  assertInventoryCursorView(cursor, value.fingerprint)
  const groups =
    read.kind === 'groups'
      ? value.groups.filter((row) => inventoryGroupMatchesFilters(row, read.filters))
      : []
  const holders =
    read.kind === 'holders' ? value.holders.filter((row) => row.groupKey === read.groupKey) : []
  return {
    ...value,
    version: 1,
    corporationId: null,
    groups:
      read.kind === 'groups'
        ? page(groups, (row) => row.key, read, binding, value.fingerprint, cursor)
        : emptyPage(),
    holders:
      read.kind === 'holders'
        ? page(
            holders,
            (row) => row.characterId.toString(),
            read,
            binding,
            value.fingerprint,
            cursor,
          )
        : emptyPage(),
    coverage:
      read.kind === 'coverage'
        ? page(
            value.coverage.toSorted((a, b) => a.characterId - b.characterId),
            (row) => row.characterId.toString(),
            read,
            binding,
            value.fingerprint,
            cursor,
          )
        : emptyPage(),
  }
}
