import { useMutation, useQueryCache } from '@pinia/colada'
import { shallowRef, type ShallowRef } from 'vue'
import { mailDeleteMutation, mailReadMutation, type MailHeader } from '../queries/mail'
import {
  commitMailDeletion,
  commitMailReadState,
  type MailMutationTarget,
  type MailReadTarget,
} from '../queries/mail-cache'
import type { ApiClient } from '../utils/api-client'
import { reconcileMailReadOverrides } from '../utils/mail-view'

export interface MailMutationOutcome {
  error?: unknown
  success: boolean
}

function replacePendingMail(target: ShallowRef<Set<number>>, mailId: number, pending: boolean) {
  const next = new Set(target.value)
  if (pending) next.add(mailId)
  else next.delete(mailId)
  target.value = next
}

export function useMailOrganizationMutations(apiClient: ApiClient) {
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
      commitMailReadState(queryCache, target)
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
      commitMailDeletion(queryCache, target)
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
