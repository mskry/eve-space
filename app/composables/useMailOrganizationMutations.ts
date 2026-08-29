import { useMutation, useQueryCache } from '@pinia/colada'
import { shallowRef, type ShallowRef } from 'vue'
import {
  assignMailLabelsMutation,
  createMailLabelMutation,
  deleteMailLabelMutation,
  mailDeleteMutation,
  mailReadMutation,
  type CreateMailLabelMutationParameters,
  type MailHeader,
  type MailLabel,
} from '../queries/mail'
import {
  commitCreatedMailLabel,
  commitMailDeletion,
  commitMailLabelDeletion,
  commitMailLabels,
  commitMailReadState,
  type MailLabelAssignmentTarget,
  type MailMutationTarget,
  type MailReadTarget,
} from '../queries/mail-cache'
import type { ApiClient } from '../utils/api-client'
import { reconcileMailLabelOverrides, reconcileMailReadOverrides } from '../utils/mail-view'

export interface MailMutationOutcome {
  error?: unknown
  success: boolean
}

type CreateMailLabelTarget = Omit<CreateMailLabelMutationParameters, 'apiClient'>

interface DeleteMailLabelTarget {
  characterId: number
  labelId: number
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
  const labelOverrides = shallowRef(new Map<number, readonly number[]>())
  const createdLabels = shallowRef<MailLabel[]>([])
  const undeletableLabelIds = shallowRef(new Set<number>())
  const labelPendingIds = shallowRef(new Set<number>())
  const deleteLabelPendingIds = shallowRef(new Set<number>())
  const createLabelPending = shallowRef(false)
  const readOperationVersions = new Map<number, number>()
  const labelOperationVersions = new Map<number, number>()
  const deleteOperationVersions = new Map<number, number>()
  const localLabelCommits = new Map<number, readonly number[]>()
  const localCreatedLabelIds = new Set<number>()
  let createLabelVersion = 0
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
  const assignLabelsMutation = useMutation({
    mutation: (target: MailLabelAssignmentTarget) =>
      assignMailLabelsMutation({
        apiClient,
        characterId: target.characterId,
        labels: target.labels,
        mailId: target.header.mailId,
      }),
  })
  const createLabelMutation = useMutation({
    mutation: (target: CreateMailLabelTarget) => createMailLabelMutation({ apiClient, ...target }),
  })
  const deleteLabelMutation = useMutation({
    mutation: (target: DeleteMailLabelTarget) => deleteMailLabelMutation({ apiClient, ...target }),
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

  function replaceLabelOverride(mailId: number, labels: readonly number[] | undefined) {
    const next = new Map(labelOverrides.value)
    if (labels === undefined) next.delete(mailId)
    else next.set(mailId, [...labels])
    labelOverrides.value = next
  }

  async function setMailRead(target: MailReadTarget): Promise<MailMutationOutcome> {
    const mailId = target.header.mailId
    if (readPendingIds.value.has(mailId) || deletePendingIds.value.has(mailId)) {
      return { success: false }
    }

    const operationGeneration = generation
    const version = (readOperationVersions.get(mailId) ?? 0) + 1
    readOperationVersions.set(mailId, version)
    const previousOverride = readStateOverrides.value.get(mailId)
    replaceReadStateOverride(mailId, target.read)
    replacePendingMail(readPendingIds, mailId, true)

    try {
      await readMutation.mutateAsync(target)
      commitMailReadState(queryCache, target)
      return {
        success:
          generation === operationGeneration && readOperationVersions.get(mailId) === version,
      }
    } catch (error) {
      if (generation !== operationGeneration || readOperationVersions.get(mailId) !== version) {
        return { success: false }
      }
      replaceReadStateOverride(mailId, previousOverride)
      return { error, success: false }
    } finally {
      if (generation === operationGeneration && readOperationVersions.get(mailId) === version) {
        replacePendingMail(readPendingIds, mailId, false)
      }
    }
  }

  async function deleteMail(target: MailMutationTarget): Promise<MailMutationOutcome> {
    const mailId = target.header.mailId
    if (
      readPendingIds.value.has(mailId) ||
      labelPendingIds.value.has(mailId) ||
      deletePendingIds.value.has(mailId)
    ) {
      return { success: false }
    }

    const operationGeneration = generation
    const version = (deleteOperationVersions.get(mailId) ?? 0) + 1
    deleteOperationVersions.set(mailId, version)
    replaceDeletedMail(mailId, true)
    replacePendingMail(deletePendingIds, mailId, true)

    try {
      await deleteMutation.mutateAsync(target)
      commitMailDeletion(queryCache, target)
      return {
        success:
          generation === operationGeneration && deleteOperationVersions.get(mailId) === version,
      }
    } catch (error) {
      if (generation !== operationGeneration || deleteOperationVersions.get(mailId) !== version) {
        return { success: false }
      }
      replaceDeletedMail(mailId, false)
      return { error, success: false }
    } finally {
      if (generation === operationGeneration && deleteOperationVersions.get(mailId) === version) {
        replacePendingMail(deletePendingIds, mailId, false)
      }
    }
  }

  async function assignMailLabels(target: MailLabelAssignmentTarget): Promise<MailMutationOutcome> {
    const mailId = target.header.mailId
    if (
      labelPendingIds.value.has(mailId) ||
      deletePendingIds.value.has(mailId) ||
      deleteLabelPendingIds.value.size > 0
    ) {
      return { success: false }
    }

    const operationGeneration = generation
    const version = (labelOperationVersions.get(mailId) ?? 0) + 1
    labelOperationVersions.set(mailId, version)
    const previousOverride = labelOverrides.value.get(mailId)
    replaceLabelOverride(mailId, target.labels)
    replacePendingMail(labelPendingIds, mailId, true)

    try {
      await assignLabelsMutation.mutateAsync(target)
      localLabelCommits.set(mailId, target.labels)
      commitMailLabels(queryCache, target)
      queueMicrotask(() => {
        if (localLabelCommits.get(mailId) === target.labels) localLabelCommits.delete(mailId)
      })
      return {
        success:
          generation === operationGeneration && labelOperationVersions.get(mailId) === version,
      }
    } catch (error) {
      if (generation !== operationGeneration || labelOperationVersions.get(mailId) !== version) {
        return { success: false }
      }
      replaceLabelOverride(mailId, previousOverride)
      return { error, success: false }
    } finally {
      if (generation === operationGeneration && labelOperationVersions.get(mailId) === version) {
        replacePendingMail(labelPendingIds, mailId, false)
      }
    }
  }

  async function createMailLabel(target: CreateMailLabelTarget): Promise<MailMutationOutcome> {
    if (createLabelPending.value) return { success: false }
    const operationGeneration = generation
    const version = ++createLabelVersion
    createLabelPending.value = true
    try {
      const labelId = await createLabelMutation.mutateAsync(target)
      if (generation !== operationGeneration || createLabelVersion !== version) {
        return { success: false }
      }
      const label: MailLabel = {
        color: target.color ?? '#ffffff',
        labelId,
        name: target.name,
        unreadCount: 0,
      }
      if (!createdLabels.value.some((candidate) => candidate.labelId === labelId)) {
        createdLabels.value = [...createdLabels.value, label]
      }
      localCreatedLabelIds.add(labelId)
      commitCreatedMailLabel(queryCache, target.characterId, label)
      queueMicrotask(() => localCreatedLabelIds.delete(labelId))
      return { success: true }
    } catch (error) {
      if (generation !== operationGeneration || createLabelVersion !== version) {
        return { success: false }
      }
      return { error, success: false }
    } finally {
      if (generation === operationGeneration && createLabelVersion === version) {
        createLabelPending.value = false
      }
    }
  }

  async function deleteMailLabel(target: DeleteMailLabelTarget): Promise<MailMutationOutcome> {
    if (deleteLabelPendingIds.value.has(target.labelId) || labelPendingIds.value.size > 0) {
      return { success: false }
    }
    const operationGeneration = generation
    replacePendingMail(deleteLabelPendingIds, target.labelId, true)
    try {
      await deleteLabelMutation.mutateAsync(target)
      if (generation !== operationGeneration) return { success: false }
      commitMailLabelDeletion(queryCache, target.characterId, target.labelId)
      createdLabels.value = createdLabels.value.filter((label) => label.labelId !== target.labelId)
      labelOverrides.value = new Map(
        [...labelOverrides.value].map(([mailId, labels]) => [
          mailId,
          labels.filter((labelId) => labelId !== target.labelId),
        ]),
      )
      return { success: true }
    } catch (error) {
      if (generation !== operationGeneration) return { success: false }
      return { error, success: false }
    } finally {
      if (generation === operationGeneration) {
        replacePendingMail(deleteLabelPendingIds, target.labelId, false)
      }
    }
  }

  function reconcileReadState(headers: readonly MailHeader[]) {
    const reconciled = reconcileMailReadOverrides(headers, readStateOverrides.value)
    if (reconciled !== readStateOverrides.value) {
      readStateOverrides.value = new Map(reconciled)
    }
  }

  function reconcileLabelState(headers: readonly Pick<MailHeader, 'labelIds' | 'mailId'>[]) {
    const retrievedHeaders = headers.filter((header) => {
      const localCommit = localLabelCommits.get(header.mailId)
      return !localCommit || !sameMailLabelSets(localCommit, header.labelIds)
    })
    const reconciled = reconcileMailLabelOverrides(retrievedHeaders, labelOverrides.value)
    if (reconciled !== labelOverrides.value) {
      labelOverrides.value = new Map(reconciled)
    }
  }

  function reconcileCreatedLabels(labels: readonly MailLabel[]) {
    const retrievedIds = new Set(
      labels.flatMap((label) =>
        label.labelId === null || localCreatedLabelIds.has(label.labelId) ? [] : [label.labelId],
      ),
    )
    const reconciled = createdLabels.value.filter(
      (label) => label.labelId === null || !retrievedIds.has(label.labelId),
    )
    if (reconciled.length !== createdLabels.value.length) createdLabels.value = reconciled
  }

  function markLabelUndeletable(labelId: number) {
    undeletableLabelIds.value = new Set([...undeletableLabelIds.value, labelId])
  }

  function resetMailMutations() {
    generation += 1
    readStateOverrides.value = new Map()
    deletedMailIds.value = new Set()
    readPendingIds.value = new Set()
    deletePendingIds.value = new Set()
    labelOverrides.value = new Map()
    createdLabels.value = []
    undeletableLabelIds.value = new Set()
    labelPendingIds.value = new Set()
    deleteLabelPendingIds.value = new Set()
    createLabelPending.value = false
    localLabelCommits.clear()
    localCreatedLabelIds.clear()
  }

  return {
    assignMailLabels,
    createLabelPending,
    createMailLabel,
    createdLabels,
    deleteMailLabel,
    deleteLabelPendingIds,
    deleteMail,
    deletedMailIds,
    deletePendingIds,
    labelOverrides,
    labelPendingIds,
    markLabelUndeletable,
    readPendingIds,
    readStateOverrides,
    reconcileCreatedLabels,
    reconcileLabelState,
    reconcileReadState,
    resetMailMutations,
    setMailRead,
    undeletableLabelIds,
  }
}

function sameMailLabelSets(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return rightIds.size === right.length && left.every((labelId) => rightIds.has(labelId))
}
