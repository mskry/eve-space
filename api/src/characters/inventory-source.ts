import {
  normalizeInventoryObservation,
  type NormalizedInventoryItem,
} from '@eve-space/core-eve-projections/asset-inventory'
import {
  platformInventoryBounds,
  type PlatformAdmittedPersonalInventory,
  type PlatformInventoryCoverageState,
  type PlatformInventorySource,
  type PlatformPersonalInventorySubject,
} from '@eve-space/platform-module-contract/inventory'
import { isEsiAuthorizationFailure } from '../esi-gateway/failures.js'
import { ReadAdmissionError } from '../auth/read-policy.js'
import { inventoryFingerprint } from '../inventory-policy.js'
import { assetFingerprint } from './asset-cursor.js'
import { loadCharacterAssetPage, CharacterAssetsPaginationError } from './asset-pages.js'
import type { CharacterAssetWindowWork } from './asset-work.js'

type AssetPage = Awaited<ReturnType<typeof loadCharacterAssetPage>>
type SourceGap = Extract<
  PlatformInventoryCoverageState,
  'authorization-required' | 'unavailable' | 'incomplete' | 'beyond-retention'
>

export interface PersonalInventorySource {
  readonly characterId: number
  readonly state: 'included-current' | 'included-stale' | SourceGap
  readonly source: PlatformInventorySource | null
  readonly items: readonly NormalizedInventoryItem[]
}

export class InventorySourceLimitError extends Error {
  readonly code = 'INVENTORY_LIMIT'
  constructor() {
    super('Inventory source exceeds supported bounds. Narrow the selected characters.')
  }
}

export class InventorySourceRestartError extends Error {
  readonly code = 'INVENTORY_SOURCE_CHANGED'
  constructor() {
    super('Inventory source changed or expired. Restart the read.')
  }
}

const checkPage = (
  page: AssetPage,
  subject: PlatformPersonalInventorySubject,
  expected: number,
) => {
  if (page.authorizationGeneration !== subject.authorizationRevision)
    throw new InventorySourceRestartError()
  if (page.data.page !== expected || page.data.assets.length > 1000)
    throw new CharacterAssetsPaginationError()
  if (!Number.isSafeInteger(page.data.totalPages) || page.data.totalPages < expected)
    throw new CharacterAssetsPaginationError()
}

const earliest = (values: readonly string[]) =>
  values.toSorted((left, right) => left.localeCompare(right))[0]!

const sourceClock = (pages: readonly AssetPage[]): PlatformInventorySource => {
  if (
    pages.some((page) =>
      [page.validatedAt, page.cachedUntil, page.readableUntil ?? page.cachedUntil].some(
        (value) => !Number.isFinite(Date.parse(value)),
      ),
    )
  )
    throw new TypeError('Inventory source contains invalid timing metadata')
  const validatedAt = earliest(pages.map((page) => page.validatedAt))
  const freshUntil = earliest(pages.map((page) => page.cachedUntil))
  return {
    observationId: inventoryFingerprint(pages.map(assetFingerprint)),
    observedAt: validatedAt,
    validatedAt,
    freshUntil,
    retainedUntil: earliest(pages.map((page) => page.readableUntil ?? page.cachedUntil)),
  }
}

const sourceState = (
  pages: readonly AssetPage[],
  source: PlatformInventorySource,
): PersonalInventorySource['state'] => {
  const now = Date.now()
  if (!Number.isFinite(Date.parse(source.retainedUntil)) || Date.parse(source.retainedUntil) <= now)
    return 'beyond-retention'
  const stale = pages.some((page) => page.stale || Date.parse(page.cachedUntil) <= now)
  if (!stale) return 'included-current'
  const allowed = pages.every(
    (page) =>
      Date.parse(page.cachedUntil) > now ||
      (page.stale &&
        (page.refreshFailureClass === 'esi-unavailable' ||
          page.refreshFailureClass === 'esi-cooldown')),
  )
  return allowed ? 'included-stale' : 'unavailable'
}

const sourceGap = (characterId: number, state: SourceGap): PersonalInventorySource => ({
  characterId,
  state,
  source: null,
  items: [],
})

const gapForFailure = (error: Error): SourceGap => {
  if (error instanceof CharacterAssetsPaginationError || error instanceof TypeError)
    return 'incomplete'
  if (isEsiAuthorizationFailure(error)) return 'authorization-required'
  return 'unavailable'
}

const propagateFailure = (error: Error) => {
  if (error instanceof ReadAdmissionError) throw error
  if (error instanceof InventorySourceLimitError || error instanceof InventorySourceRestartError)
    throw error
  if ('extensions' in error) throw error
}

const readSubject = async (
  subject: PlatformPersonalInventorySubject,
  work: CharacterAssetWindowWork,
  reservePages: (count: number) => void,
): Promise<PersonalInventorySource> => {
  const load = (page: number) =>
    work.run(async () => {
      work.signal.throwIfAborted()
      const value = await loadCharacterAssetPage(
        subject.characterId,
        subject.characterLifecycle,
        page,
        work.signal,
      )
      checkPage(value, subject, page)
      return value
    })
  try {
    const first = await load(1)
    if (first.data.totalPages > platformInventoryBounds.personalRecordsPerSubject / 1000)
      throw new InventorySourceLimitError()
    reservePages(first.data.totalPages - 1)
    const pages = [first]
    for (let page = 2; page <= first.data.totalPages; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Stop admitting pages when pagination changes or cancellation arrives.
      const next = await load(page)
      if (next.data.totalPages !== first.data.totalPages) throw new CharacterAssetsPaginationError()
      pages.push(next)
    }
    const assets = pages.flatMap((page) => page.data.assets)
    if (assets.length > platformInventoryBounds.personalRecordsPerSubject)
      throw new InventorySourceLimitError()
    const items = normalizeInventoryObservation(assets)
    const source = sourceClock(pages)
    const state = sourceState(pages, source)
    if (state !== 'included-current' && state !== 'included-stale')
      return sourceGap(subject.characterId, state)
    return { characterId: subject.characterId, state, source, items }
  } catch (error) {
    work.signal.throwIfAborted()
    const failure = error instanceof Error ? error : new Error('Asset source unavailable')
    propagateFailure(failure)
    return sourceGap(subject.characterId, gapForFailure(failure))
  }
}

export const assertPersonalInventorySourceCurrent = (
  sources: readonly PersonalInventorySource[],
) => {
  for (const value of sources) {
    if (!value.source) continue
    const deadline =
      value.state === 'included-current' ? value.source.freshUntil : value.source.retainedUntil
    if (Date.parse(deadline) <= Date.now()) throw new InventorySourceRestartError()
  }
}

export const readPersonalInventorySources = async (
  admission: PlatformAdmittedPersonalInventory,
  work: CharacterAssetWindowWork,
): Promise<readonly PersonalInventorySource[]> => {
  if (admission.subjects.length > platformInventoryBounds.personalSubjects)
    throw new InventorySourceLimitError()
  if (
    new Set(admission.subjects.map((subject) => subject.characterId)).size !==
    admission.subjects.length
  )
    throw new InventorySourceRestartError()
  if (
    admission.subjects.some(
      (subject) => !subject.evidenceReadable || subject.userId !== admission.actorUserId,
    )
  )
    throw new InventorySourceRestartError()
  let reserved = admission.subjects.length
  const reservePages = (count: number) => {
    reserved += count
    if (reserved > platformInventoryBounds.personalSourcePages)
      throw new InventorySourceLimitError()
  }
  const sources: PersonalInventorySource[] = []
  for (const subject of admission.subjects) {
    work.signal.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Reserve each source's full page count before admitting another source.
    sources.push(await readSubject(subject, work, reservePages))
  }
  work.signal.throwIfAborted()
  assertPersonalInventorySourceCurrent(sources)
  return sources
}
