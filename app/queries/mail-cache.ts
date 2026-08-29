import type { QueryCache } from '@pinia/colada'
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

function updateUnreadCounts(labels: MailLabels, header: MailHeader, delta: number): MailLabels {
  if (delta === 0) return labels
  const affectedLabels = new Set(header.labelIds)
  return {
    ...labels,
    labels: labels.labels.map((label) =>
      label.labelId !== null && label.unreadCount !== null && affectedLabels.has(label.labelId)
        ? { ...label, unreadCount: Math.max(0, label.unreadCount + delta) }
        : label,
    ),
    totalUnreadCount:
      labels.totalUnreadCount === null ? null : Math.max(0, labels.totalUnreadCount + delta),
  }
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

export function commitMailReadState(queryCache: QueryCache, target: MailReadTarget) {
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
    const wasUnread = isMailUnread(target.header.isRead)
    const isUnread = !target.read
    let unreadDelta = 0
    if (wasUnread !== isUnread) unreadDelta = isUnread ? 1 : -1
    queryCache.setQueryData<MailLabels>(
      labelsKey,
      updateUnreadCounts(labels, target.header, unreadDelta),
    )
  }
}

export function commitMailDeletion(queryCache: QueryCache, target: MailMutationTarget) {
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

  if (!isMailUnread(target.header.isRead)) return
  const labelsKey = PRIVATE_QUERY_KEYS.mailLabels(target.characterId)
  const labels = queryCache.getQueryData<MailLabels>(labelsKey)
  if (labels) {
    queryCache.setQueryData<MailLabels>(labelsKey, updateUnreadCounts(labels, target.header, -1))
  }
}
