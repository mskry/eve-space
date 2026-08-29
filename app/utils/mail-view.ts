import type { MailHeader, MailLabel, MailParty } from '../queries/mail'
import { ApiQueryError } from './query-error'

export interface MailFilters {
  mailingListId: number | null
  search: string
  unreadOnly: boolean
}

export type MailboxStatus = 'cooldown' | 'error' | 'idle' | 'loading' | 'scope-required'

export const MAIL_READ_DWELL_MS = 500

// ESI omits is_read for unread headers, so true is the only read state.
export function isMailUnread(isRead: MailHeader['isRead']) {
  return isRead !== true
}

export function mailPartyName(party: MailParty | null, role = 'party') {
  const name = party?.name?.trim()
  if (name) return name
  if (!party) return `Unknown ${role}`
  return `Unknown ${party.type.replace('_', ' ')} #${party.id}`
}

export function filterLoadedMailHeaders(headers: readonly MailHeader[], filters: MailFilters) {
  const search = filters.search.trim().toLocaleLowerCase()

  return headers.filter((header) => {
    if (filters.unreadOnly && !isMailUnread(header.isRead)) return false
    if (
      filters.mailingListId !== null &&
      !header.recipients.some(
        (recipient) => recipient.type === 'mailing_list' && recipient.id === filters.mailingListId,
      )
    ) {
      return false
    }
    if (!search) return true

    return [header.subject ?? '', mailPartyName(header.sender, 'sender')].some((value) =>
      value.toLocaleLowerCase().includes(search),
    )
  })
}

export function filterDisplayedMailHeaders(
  headers: readonly MailHeader[],
  filters: MailFilters,
  openMailId: number | null,
) {
  if (!filters.unreadOnly || openMailId === null) {
    return filterLoadedMailHeaders(headers, filters)
  }

  const visibleIds = new Set(
    filterLoadedMailHeaders(headers, filters).map((header) => header.mailId),
  )
  const openMessageMatchesOtherFilters = filterLoadedMailHeaders(headers, {
    ...filters,
    unreadOnly: false,
  }).some((header) => header.mailId === openMailId)
  if (openMessageMatchesOtherFilters) visibleIds.add(openMailId)
  return headers.filter((header) => visibleIds.has(header.mailId))
}

export function applyMailOverlays(
  headers: readonly MailHeader[],
  readStateOverrides: ReadonlyMap<number, boolean>,
  deletedMailIds: ReadonlySet<number>,
  labelOverrides: ReadonlyMap<number, readonly number[]>,
) {
  return headers.flatMap((header) => {
    if (deletedMailIds.has(header.mailId)) return []
    const readState = readStateOverrides.get(header.mailId)
    const labelIds = labelOverrides.get(header.mailId)
    return readState === undefined && labelIds === undefined
      ? [header]
      : [
          {
            ...header,
            ...(readState === undefined ? {} : { isRead: readState }),
            ...(labelIds === undefined ? {} : { labelIds: [...labelIds] }),
          },
        ]
  })
}

export function removeMailLabelIds<T extends Pick<MailHeader, 'labelIds'>>(
  mail: T,
  deletedLabelIds: ReadonlySet<number>,
): T {
  const labelIds = mail.labelIds.filter((labelId) => !deletedLabelIds.has(labelId))
  return labelIds.length === mail.labelIds.length ? mail : { ...mail, labelIds }
}

export function sameMailLabelIds(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return rightIds.size === right.length && left.every((labelId) => rightIds.has(labelId))
}

export function reconcileMailReadOverrides(
  headers: readonly MailHeader[],
  readStateOverrides: ReadonlyMap<number, boolean>,
) {
  let reconciled: Map<number, boolean> | undefined
  for (const header of headers) {
    const override = readStateOverrides.get(header.mailId)
    if (override === undefined || (header.isRead === true) !== override) continue
    reconciled ??= new Map(readStateOverrides)
    reconciled.delete(header.mailId)
  }
  return reconciled ?? readStateOverrides
}

export function reconcileMailLabelOverrides(
  headers: readonly Pick<MailHeader, 'labelIds' | 'mailId'>[],
  labelOverrides: ReadonlyMap<number, readonly number[]>,
) {
  let reconciled: Map<number, readonly number[]> | undefined
  for (const header of headers) {
    const override = labelOverrides.get(header.mailId)
    if (!override || !sameMailLabelIds(header.labelIds, override)) continue
    reconciled ??= new Map(labelOverrides)
    reconciled.delete(header.mailId)
  }
  return reconciled ?? labelOverrides
}

function accumulateMailCountDeltas(
  labelDeltas: Map<number, number>,
  header: MailHeader,
  options: {
    deletedMailIds: ReadonlySet<number>
    labelOverrides: ReadonlyMap<number, readonly number[]>
    readStateOverrides: ReadonlyMap<number, boolean>
  },
) {
  const wasUnread = isMailUnread(header.isRead)
  const readOverride = options.readStateOverrides.get(header.mailId)
  const deleted = options.deletedMailIds.has(header.mailId)
  let isUnread = wasUnread
  if (deleted) isUnread = false
  else if (readOverride !== undefined) isUnread = !readOverride
  const previousLabels = new Set(header.labelIds)
  const displayedLabels = new Set(
    deleted ? [] : (options.labelOverrides.get(header.mailId) ?? header.labelIds),
  )
  for (const labelId of new Set([...previousLabels, ...displayedLabels])) {
    const previousContribution = Number(wasUnread && previousLabels.has(labelId))
    const displayedContribution = Number(isUnread && displayedLabels.has(labelId))
    const delta = displayedContribution - previousContribution
    if (delta !== 0) labelDeltas.set(labelId, (labelDeltas.get(labelId) ?? 0) + delta)
  }
  return Number(isUnread) - Number(wasUnread)
}

export function deriveDisplayedMailCounts(options: {
  deletedMailIds: ReadonlySet<number>
  headers: readonly MailHeader[]
  labels: readonly MailLabel[]
  labelOverrides: ReadonlyMap<number, readonly number[]>
  readStateOverrides: ReadonlyMap<number, boolean>
  totalUnreadCount: number | null
}) {
  const labelDeltas = new Map<number, number>()
  let totalDelta = 0
  const visited = new Set<number>()

  for (const header of options.headers) {
    if (visited.has(header.mailId)) continue
    visited.add(header.mailId)
    totalDelta += accumulateMailCountDeltas(labelDeltas, header, options)
  }

  return {
    labels: options.labels.map((label) => {
      if (label.labelId === null || label.unreadCount === null) return label
      const delta = labelDeltas.get(label.labelId) ?? 0
      return delta === 0 ? label : { ...label, unreadCount: Math.max(0, label.unreadCount + delta) }
    }),
    totalUnreadCount:
      options.totalUnreadCount === null ? null : Math.max(0, options.totalUnreadCount + totalDelta),
  }
}

export function scheduleMailReadDwell(callback: () => void, delay = MAIL_READ_DWELL_MS) {
  const timer = setTimeout(callback, delay)
  return () => clearTimeout(timer)
}

export function appendUniqueMailHeaders(
  current: readonly MailHeader[],
  older: readonly MailHeader[],
) {
  const retainedIds = new Set(current.map((header) => header.mailId))
  return [...current, ...older.filter((header) => !retainedIds.has(header.mailId))]
}

export function mergePaginatedMailHeaders(
  current: readonly MailHeader[],
  latest: readonly MailHeader[],
) {
  return appendUniqueMailHeaders(latest, current)
}

export function replaceLatestMailHeaders(latest: readonly MailHeader[]) {
  return [...latest]
}

export function splitMailBodyParagraphs(body: string | null) {
  if (!body) return []
  return body
    .replaceAll('\r\n', '\n')
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function deriveMailboxStatus(options: {
  errors: readonly unknown[]
  hasInitialData: boolean
  loading: boolean
}): MailboxStatus {
  if (options.hasInitialData) return 'idle'
  const errors = options.errors.filter((error): error is Error => error instanceof Error)
  if (
    errors.some(
      (error) =>
        error instanceof ApiQueryError &&
        (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED'),
    )
  ) {
    return 'scope-required'
  }
  if (
    errors.some(
      (error) =>
        error instanceof ApiQueryError && (error.status === 429 || error.code === 'ESI_COOLDOWN'),
    )
  ) {
    return 'cooldown'
  }
  if (errors.length > 0) return 'error'
  if (options.loading) return 'loading'
  return 'idle'
}
