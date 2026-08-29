import type { EntryKey, QueryCache } from '@pinia/colada'
import type { MailDetail, MailHeader, MailHeaders, MailLabels } from './mail'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { isMailUnread } from '../utils/mail-view'

export interface MailMutationTarget {
  characterId: number
  header: MailHeader
}

export interface MailReadTarget extends MailMutationTarget {
  read: boolean
}

export interface MailLabelAssignmentTarget extends MailMutationTarget {
  labels: readonly number[]
}

interface CachedMailState {
  isRead: MailHeader['isRead']
  labelIds: readonly number[]
}

function replaceMailHeaderLabels(header: MailHeader, labelIds: readonly number[]): MailHeader {
  return { ...header, labelIds: [...labelIds] }
}

function updateUnreadCounts(
  labels: MailLabels,
  previous: CachedMailState,
  next?: CachedMailState,
): MailLabels {
  const wasUnread = isMailUnread(previous.isRead)
  const isUnread = next ? isMailUnread(next.isRead) : false
  const previousLabels = new Set(previous.labelIds)
  const nextLabels = new Set(next?.labelIds ?? [])
  const labelDeltas = new Map<number, number>()
  for (const labelId of new Set([...previousLabels, ...nextLabels])) {
    const delta =
      Number(isUnread && nextLabels.has(labelId)) - Number(wasUnread && previousLabels.has(labelId))
    if (delta !== 0) labelDeltas.set(labelId, delta)
  }
  const totalDelta = Number(isUnread) - Number(wasUnread)
  if (labelDeltas.size === 0 && totalDelta === 0) return labels
  return {
    ...labels,
    labels: labels.labels.map((label) =>
      label.labelId !== null && label.unreadCount !== null && labelDeltas.has(label.labelId)
        ? {
            ...label,
            unreadCount: Math.max(0, label.unreadCount + labelDeltas.get(label.labelId)!),
          }
        : label,
    ),
    totalUnreadCount:
      labels.totalUnreadCount === null ? null : Math.max(0, labels.totalUnreadCount + totalDelta),
  }
}

function cachedMailState(queryCache: QueryCache, target: MailMutationTarget): CachedMailState {
  const detail = queryCache.getQueryData<MailDetail>(
    PRIVATE_QUERY_KEYS.mailDetail(target.characterId, target.header.mailId),
  )
  if (detail) return detail

  const mailKey = PRIVATE_QUERY_KEYS.mail(target.characterId)
  for (const entry of queryCache.getEntries({ key: [...mailKey, 'headers'] })) {
    const header = queryCache
      .getQueryData<MailHeaders>(entry.key)
      ?.messages.find((candidate) => candidate.mailId === target.header.mailId)
    if (header) return header
  }
  return target.header
}

function cancelPendingMailQueries(queryCache: QueryCache, characterId: number, mailId: number) {
  const mailKey = PRIVATE_QUERY_KEYS.mail(characterId)
  const entries = [
    ...queryCache
      .getEntries({ key: [...mailKey, 'headers'] })
      .filter(
        (entry) =>
          entry.key.at(-1) === null ||
          queryCache
            .getQueryData<MailHeaders>(entry.key)
            ?.messages.some((header) => header.mailId === mailId),
      ),
    ...queryCache.getEntries({ exact: true, key: PRIVATE_QUERY_KEYS.mailLabels(characterId) }),
    ...queryCache.getEntries({
      exact: true,
      key: PRIVATE_QUERY_KEYS.mailDetail(characterId, mailId),
    }),
  ]
  for (const entry of entries) {
    if (entry.pending) queryCache.cancel(entry, new Error('Mail cache updated by mutation.'))
  }
}

function commitMailHeaderLabels(
  queryCache: QueryCache,
  entryKey: EntryKey,
  labelFilterIndex: number,
  target: MailLabelAssignmentTarget,
  previousLabelIds: ReadonlySet<number>,
) {
  const page = queryCache.getQueryData<MailHeaders>(entryKey)
  if (!page) return
  const nextLabelIds = new Set(target.labels)
  const labelFilter = entryKey[labelFilterIndex]
  const filteredLabelIds = Array.isArray(labelFilter)
    ? labelFilter.filter((labelId): labelId is number => typeof labelId === 'number')
    : []
  const membershipChanged = filteredLabelIds.some(
    (labelId) => previousLabelIds.has(labelId) !== nextLabelIds.has(labelId),
  )
  const matchesNextFilter =
    filteredLabelIds.length === 0 || filteredLabelIds.some((labelId) => nextLabelIds.has(labelId))
  if (membershipChanged && matchesNextFilter && entryKey.at(-1) !== null) {
    void queryCache.invalidateQueries({ exact: true, key: entryKey }, false)
    return
  }

  const updatedHeader = replaceMailHeaderLabels(target.header, target.labels)
  let messages = page.messages.map((header) =>
    header.mailId === target.header.mailId ? updatedHeader : header,
  )
  if (membershipChanged) {
    messages = matchesNextFilter
      ? [updatedHeader, ...messages.filter((header) => header.mailId !== target.header.mailId)]
          .toSorted((left, right) => right.mailId - left.mailId)
          .slice(0, 50)
      : messages.filter((header) => header.mailId !== target.header.mailId)
  }
  queryCache.setQueryData<MailHeaders>(entryKey, {
    ...page,
    messages,
    ...(membershipChanged && matchesNextFilter && page.nextLastMailId !== null
      ? { nextLastMailId: messages.at(-1)?.mailId ?? null }
      : {}),
  })
}

export function commitMailReadState(queryCache: QueryCache, target: MailReadTarget) {
  const previous = cachedMailState(queryCache, target)
  cancelPendingMailQueries(queryCache, target.characterId, target.header.mailId)
  const mailKey = PRIVATE_QUERY_KEYS.mail(target.characterId)
  for (const entry of queryCache.getEntries({ key: [...mailKey, 'headers'] })) {
    const page = queryCache.getQueryData<MailHeaders>(entry.key)
    if (!page) continue
    const updateReadState = (header: MailHeader) =>
      header.mailId === target.header.mailId ? { ...header, isRead: target.read } : header
    queryCache.setQueryData<MailHeaders>(entry.key, {
      ...page,
      messages: page.messages.map(updateReadState),
    })
  }

  const detailKey = PRIVATE_QUERY_KEYS.mailDetail(target.characterId, target.header.mailId)
  const detail = queryCache.getQueryData<MailDetail>(detailKey)
  if (detail) queryCache.setQueryData<MailDetail>(detailKey, { ...detail, isRead: target.read })

  const labelsKey = PRIVATE_QUERY_KEYS.mailLabels(target.characterId)
  const labels = queryCache.getQueryData<MailLabels>(labelsKey)
  if (labels) {
    queryCache.setQueryData<MailLabels>(
      labelsKey,
      updateUnreadCounts(labels, previous, { ...previous, isRead: target.read }),
    )
  }
}

export function commitMailLabels(queryCache: QueryCache, target: MailLabelAssignmentTarget) {
  const previous = cachedMailState(queryCache, target)
  cancelPendingMailQueries(queryCache, target.characterId, target.header.mailId)
  const mailKey = PRIVATE_QUERY_KEYS.mail(target.characterId)
  const previousLabelIds = new Set(previous.labelIds)
  for (const entry of queryCache.getEntries({ key: [...mailKey, 'headers'] })) {
    commitMailHeaderLabels(queryCache, entry.key, mailKey.length + 1, target, previousLabelIds)
  }

  const detailKey = PRIVATE_QUERY_KEYS.mailDetail(target.characterId, target.header.mailId)
  const detail = queryCache.getQueryData<MailDetail>(detailKey)
  if (detail) {
    queryCache.setQueryData<MailDetail>(detailKey, { ...detail, labelIds: [...target.labels] })
  }

  const labelsKey = PRIVATE_QUERY_KEYS.mailLabels(target.characterId)
  const labels = queryCache.getQueryData<MailLabels>(labelsKey)
  if (labels) {
    queryCache.setQueryData<MailLabels>(
      labelsKey,
      updateUnreadCounts(labels, previous, { ...previous, labelIds: target.labels }),
    )
  }
}

export function commitCreatedMailLabel(
  queryCache: QueryCache,
  characterId: number,
  label: MailLabels['labels'][number],
) {
  const key = PRIVATE_QUERY_KEYS.mailLabels(characterId)
  for (const entry of queryCache.getEntries({ exact: true, key })) {
    if (entry.pending) queryCache.cancel(entry, new Error('Mail cache updated by mutation.'))
  }
  const labels = queryCache.getQueryData<MailLabels>(key)
  if (!labels) return
  const replacesExisting = labels.labels.some((candidate) => candidate.labelId === label.labelId)
  queryCache.setQueryData<MailLabels>(key, {
    ...labels,
    labels: replacesExisting
      ? labels.labels.map((candidate) => (candidate.labelId === label.labelId ? label : candidate))
      : [...labels.labels, label],
  })
}

export function prepareMailForReusedLabel(
  queryCache: QueryCache,
  characterId: number,
  labelId: number,
) {
  const mailKey = PRIVATE_QUERY_KEYS.mail(characterId)
  const entries = [
    ...queryCache.getEntries({ key: [...mailKey, 'headers'] }),
    ...queryCache.getEntries({ key: [...mailKey, 'detail'] }),
  ]
  for (const entry of entries) {
    if (entry.pending) queryCache.cancel(entry, new Error('Mail label identity was reused.'))
  }
  removeMailLabelFromPayloadCaches(queryCache, mailKey, labelId)
  for (const entry of entries) {
    if (entry.active) {
      void queryCache.invalidateQueries({ exact: true, key: entry.key })
    } else {
      entry.when = 0
    }
  }
}

export function commitMailLabelDeletion(
  queryCache: QueryCache,
  characterId: number,
  labelId: number,
) {
  const mailKey = PRIVATE_QUERY_KEYS.mail(characterId)
  removeMailLabelFromPayloadCaches(queryCache, mailKey, labelId)

  const labelsKey = PRIVATE_QUERY_KEYS.mailLabels(characterId)
  const labels = queryCache.getQueryData<MailLabels>(labelsKey)
  if (labels) {
    queryCache.setQueryData<MailLabels>(labelsKey, {
      ...labels,
      labels: labels.labels.filter((label) => label.labelId !== labelId),
    })
  }
}

function removeMailLabelFromPayloadCaches(
  queryCache: QueryCache,
  mailKey: EntryKey,
  labelId: number,
) {
  for (const entry of queryCache.getEntries({ key: [...mailKey, 'headers'] })) {
    const page = queryCache.getQueryData<MailHeaders>(entry.key)
    if (!page) continue
    queryCache.setQueryData<MailHeaders>(entry.key, {
      ...page,
      messages: page.messages.map((header) => {
        if (!header.labelIds.includes(labelId)) return header
        return replaceMailHeaderLabels(
          header,
          header.labelIds.filter((candidate) => candidate !== labelId),
        )
      }),
    })
  }

  for (const entry of queryCache.getEntries({ key: [...mailKey, 'detail'] })) {
    const detail = queryCache.getQueryData<MailDetail>(entry.key)
    if (!detail?.labelIds.includes(labelId)) continue
    queryCache.setQueryData<MailDetail>(entry.key, {
      ...detail,
      labelIds: detail.labelIds.filter((candidate) => candidate !== labelId),
    })
  }
}

export function commitMailDeletion(queryCache: QueryCache, target: MailMutationTarget) {
  const previous = cachedMailState(queryCache, target)
  cancelPendingMailQueries(queryCache, target.characterId, target.header.mailId)
  const mailKey = PRIVATE_QUERY_KEYS.mail(target.characterId)
  for (const entry of queryCache.getEntries({ key: [...mailKey, 'headers'] })) {
    const page = queryCache.getQueryData<MailHeaders>(entry.key)
    if (!page) continue
    queryCache.setQueryData<MailHeaders>(entry.key, {
      ...page,
      messages: page.messages.filter((header) => header.mailId !== target.header.mailId),
    })
  }

  void queryCache.invalidateQueries(
    {
      exact: true,
      key: PRIVATE_QUERY_KEYS.mailDetail(target.characterId, target.header.mailId),
    },
    false,
  )

  const labelsKey = PRIVATE_QUERY_KEYS.mailLabels(target.characterId)
  const labels = queryCache.getQueryData<MailLabels>(labelsKey)
  if (labels) {
    queryCache.setQueryData<MailLabels>(labelsKey, updateUnreadCounts(labels, previous))
  }
}
