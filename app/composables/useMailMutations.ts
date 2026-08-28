import { useMutation, useQueryCache, type QueryCache } from '@pinia/colada'
import { shallowRef, type ShallowRef } from 'vue'
import {
  mailDeleteMutation,
  mailReadMutation,
  type MailDetail,
  type MailHeader,
  type MailHeaders,
  type MailLabels,
} from '../queries/mail'
import { PRIVATE_QUERY_KEYS } from '../queries/query-keys'
import type { ApiClient } from '../utils/api-client'
import { isMailUnread, reconcileMailReadOverrides } from '../utils/mail-view'

export interface MailMutationOutcome {
  error?: unknown
  success: boolean
}

interface MailMutationTarget {
  characterId: number
  header: MailHeader
}

interface MailReadTarget extends MailMutationTarget {
  read: boolean
}

function replacePendingMail(target: ShallowRef<Set<number>>, mailId: number, pending: boolean) {
  const next = new Set(target.value)
  if (pending) next.add(mailId)
  else next.delete(mailId)
  target.value = next
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

function commitReadState(queryCache: QueryCache, target: MailReadTarget) {
  cancelPendingMailQueries(queryCache, target.characterId, target.header.mailId)
  const mailKey = PRIVATE_QUERY_KEYS.mail(target.characterId)
  for (const entry of queryCache.getEntries({ key: [...mailKey, 'headers'] })) {
    const page = queryCache.getQueryData<MailHeaders>(entry.key)
    if (!page) continue
    queryCache.setQueryData<MailHeaders>(entry.key, {
      ...page,
      messages: page.messages.map((header) =>
        header.mailId === target.header.mailId
          ? Object.assign({}, header, { isRead: target.read })
          : header,
      ),
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
    queryCache.setQueryData<MailLabels>(
      labelsKey,
      updateUnreadCounts(labels, target.header, wasUnread === isUnread ? 0 : isUnread ? 1 : -1),
    )
  }
}

function commitDeletion(queryCache: QueryCache, target: MailMutationTarget) {
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

export function useMailMutations(apiClient: ApiClient) {
  const queryCache = useQueryCache()
  const readStateOverrides = shallowRef(new Map<number, boolean>())
  const deletedMailIds = shallowRef(new Set<number>())
  const readPendingIds = shallowRef(new Set<number>())
  const deletePendingIds = shallowRef(new Set<number>())
  const operationVersions = new Map<number, number>()
  let generation = 0

  const readMutation = useMutation({
    mutation: (target: MailReadTarget) =>
      mailReadMutation({
        apiClient,
        characterId: target.characterId,
        mailId: target.header.mailId,
        read: target.read,
      }),
  })
  const deleteMutation = useMutation({
    mutation: (target: MailMutationTarget) =>
      mailDeleteMutation({
        apiClient,
        characterId: target.characterId,
        mailId: target.header.mailId,
      }),
  })

  function replaceReadStateOverride(mailId: number, read: boolean | undefined) {
    const next = new Map(readStateOverrides.value)
    if (read === undefined) next.delete(mailId)
    else next.set(mailId, read)
    readStateOverrides.value = next
  }

  function replaceDeletedMail(mailId: number, deleted: boolean) {
    const next = new Set(deletedMailIds.value)
    if (deleted) next.add(mailId)
    else next.delete(mailId)
    deletedMailIds.value = next
  }

  async function setMailRead(target: MailReadTarget): Promise<MailMutationOutcome> {
    const mailId = target.header.mailId
    if (readPendingIds.value.has(mailId) || deletePendingIds.value.has(mailId)) {
      return { success: false }
    }

    const operationGeneration = generation
    const version = (operationVersions.get(mailId) ?? 0) + 1
    operationVersions.set(mailId, version)
    const previousOverride = readStateOverrides.value.get(mailId)
    replaceReadStateOverride(mailId, target.read)
    replacePendingMail(readPendingIds, mailId, true)

    try {
      await readMutation.mutateAsync(target)
      commitReadState(queryCache, target)
      return {
        success: generation === operationGeneration && operationVersions.get(mailId) === version,
      }
    } catch (error) {
      if (generation !== operationGeneration || operationVersions.get(mailId) !== version) {
        return { success: false }
      }
      replaceReadStateOverride(mailId, previousOverride)
      return { error, success: false }
    } finally {
      if (generation === operationGeneration && operationVersions.get(mailId) === version) {
        replacePendingMail(readPendingIds, mailId, false)
      }
    }
  }

  async function deleteMail(target: MailMutationTarget): Promise<MailMutationOutcome> {
    const mailId = target.header.mailId
    if (readPendingIds.value.has(mailId) || deletePendingIds.value.has(mailId)) {
      return { success: false }
    }

    const operationGeneration = generation
    const version = (operationVersions.get(mailId) ?? 0) + 1
    operationVersions.set(mailId, version)
    replaceDeletedMail(mailId, true)
    replacePendingMail(deletePendingIds, mailId, true)

    try {
      await deleteMutation.mutateAsync(target)
      commitDeletion(queryCache, target)
      return {
        success: generation === operationGeneration && operationVersions.get(mailId) === version,
      }
    } catch (error) {
      if (generation !== operationGeneration || operationVersions.get(mailId) !== version) {
        return { success: false }
      }
      replaceDeletedMail(mailId, false)
      return { error, success: false }
    } finally {
      if (generation === operationGeneration && operationVersions.get(mailId) === version) {
        replacePendingMail(deletePendingIds, mailId, false)
      }
    }
  }

  function reconcileReadState(headers: readonly MailHeader[]) {
    const reconciled = reconcileMailReadOverrides(headers, readStateOverrides.value)
    if (reconciled !== readStateOverrides.value) {
      readStateOverrides.value = new Map(reconciled)
    }
  }

  function resetMailMutations() {
    generation += 1
    readStateOverrides.value = new Map()
    deletedMailIds.value = new Set()
    readPendingIds.value = new Set()
    deletePendingIds.value = new Set()
  }

  return {
    deleteMail,
    deletedMailIds,
    deletePendingIds,
    readPendingIds,
    readStateOverrides,
    reconcileReadState,
    resetMailMutations,
    setMailRead,
  }
}
