import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import type { CreateMailLabelMutationParameters, MailHeader, MailLabel } from '../queries/mail'
import { isMailUnread, scheduleMailReadDwell } from '../utils/mail-view'
import { ApiQueryError } from '../utils/query-error'
import type { useCharacterMailbox } from './useCharacterMailbox'
import type { useMailOrganizationMutations } from './useMailOrganizationMutations'

interface MailOrganizationOptions {
  characterId: ComputedRef<number | undefined>
  mailbox: ReturnType<typeof useCharacterMailbox>
  mutations: ReturnType<typeof useMailOrganizationMutations>
}

export function useMailOrganization(options: MailOrganizationOptions) {
  const { openConfirmDialog } = useConfirmDialog()
  const { dismissToast, showToast } = useToast()
  const autoReadSuppressedMailId = ref<number | null>(null)
  const labelManagementOpen = ref(false)
  const labelAssignmentOpen = ref(false)
  const labelName = ref('')
  const labelColor = ref<CreateMailLabelMutationParameters['color']>()
  const createLabelFeedback = ref('')
  const assignmentFeedback = ref('')
  let cancelReadDwell: (() => void) | undefined
  let organizationToastKey: number | undefined
  let scopeActive = true

  const mutationPending = computed(
    () =>
      options.mailbox.selectedMailId.value !== null &&
      (options.mutations.readPendingIds.value.has(options.mailbox.selectedMailId.value) ||
        options.mutations.deletePendingIds.value.has(options.mailbox.selectedMailId.value) ||
        options.mutations.labelPendingIds.value.has(options.mailbox.selectedMailId.value)),
  )
  const assignedLabelIds = computed(() => {
    const detail = options.mailbox.displayedDetail.value
    if (!detail || detail.mailId !== options.mailbox.selectedMailId.value) return new Set<number>()
    return new Set(detail.labelIds)
  })
  function resetOrganizationView() {
    cancelReadDwell?.()
    cancelReadDwell = undefined
    autoReadSuppressedMailId.value = null
  }

  function showOrganizationToast(toast: Parameters<typeof showToast>[0]) {
    organizationToastKey = showToast(toast)
  }

  function showMutationFailure(
    action: 'assign-label' | 'create-label' | 'delete-label' | 'delete-mail' | 'read',
    error: unknown,
  ) {
    const fallback = {
      'assign-label': 'The label change was reverted.',
      'create-label': 'The label was not created.',
      'delete-label': 'The label was not deleted.',
      'delete-mail': 'The message was not deleted.',
      read: 'The read change was reverted.',
    }[action]
    if (
      error instanceof ApiQueryError &&
      (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
    ) {
      const authorizationAction = error.authorizeUrl
        ? {
            actionHref: error.authorizeUrl,
            actionLabel: 'Authorize character',
            duration: Number.POSITIVE_INFINITY,
          }
        : {}
      showOrganizationToast({
        ...authorizationAction,
        description: error.message,
        title: 'Mail organization authorization required',
      })
      return
    }
    if (error instanceof ApiQueryError && error.code === 'MAIL_MUTATION_REJECTED') {
      showOrganizationToast({
        description: `${fallback} EVE refused the change.`,
        title: 'Mail change refused',
      })
      return
    }
    let title = 'Label change reverted'
    if (action === 'read') title = 'Read change reverted'
    else if (action === 'delete-mail') title = 'Deletion reverted'
    showOrganizationToast({
      description: error instanceof Error ? `${fallback} ${error.message}` : fallback,
      title,
    })
  }

  async function changeMailRead(header: MailHeader, read: boolean, showSuccess = true) {
    if (!options.characterId.value || (header.isRead === true) === read) return
    const outcome = await options.mutations.setMailRead({
      characterId: options.characterId.value,
      header,
      read,
    })
    if (!scopeActive) return
    if (outcome.success && showSuccess) {
      showOrganizationToast({
        description: read
          ? 'The message is now shown as read.'
          : 'The message is now shown as unread.',
        title: read ? 'Message marked read' : 'Message marked unread',
      })
    } else if (outcome.error) {
      showMutationFailure('read', outcome.error)
    }
  }

  function changeOpenMessageRead(read: boolean) {
    const header = options.mailbox.selectedHeader.value
    if (!header) return
    if (!read) {
      autoReadSuppressedMailId.value = header.mailId
      cancelReadDwell?.()
      cancelReadDwell = undefined
    }
    void changeMailRead(header, read)
  }

  function requestMailDeletion() {
    const header = options.mailbox.selectedHeader.value
    if (!header) return
    const subject = header.subject?.trim() || `mail ${header.mailId}`
    openConfirmDialog({
      confirmLabel: 'Delete message',
      description:
        'This permanently deletes the message. EVE provides no archive or trash, and this action cannot be undone.',
      onConfirm: () => confirmMailDeletion(header.mailId),
      pending: () =>
        options.mutations.readPendingIds.value.has(header.mailId) ||
        options.mutations.labelPendingIds.value.has(header.mailId) ||
        options.mutations.deletePendingIds.value.has(header.mailId),
      pendingLabel: () =>
        options.mutations.readPendingIds.value.has(header.mailId) ||
        options.mutations.labelPendingIds.value.has(header.mailId)
          ? 'Waiting for mail update...'
          : 'Deleting...',
      title: `Delete ${subject}?`,
      tone: 'danger',
    })
  }

  async function confirmMailDeletion(mailId: number) {
    const selectedHeader = options.mailbox.selectedHeader.value
    const candidate =
      selectedHeader?.mailId === mailId
        ? selectedHeader
        : options.mailbox.displayedHeaders.value.find((header) => header.mailId === mailId)
    if (!candidate) return true
    if (
      !options.characterId.value ||
      options.mutations.readPendingIds.value.has(mailId) ||
      options.mutations.labelPendingIds.value.has(mailId) ||
      options.mutations.deletePendingIds.value.has(mailId)
    )
      return false
    const mutationCharacterId = options.characterId.value
    const previousSelection = options.mailbox.selectedMailId.value
    const request = options.mutations.deleteMail({
      characterId: mutationCharacterId,
      header: candidate,
    })
    options.mailbox.selectedMailId.value = null
    const outcome = await request
    if (!scopeActive || options.characterId.value !== mutationCharacterId) return true
    if (outcome.success) {
      options.mailbox.removeLoadedHeader(mailId)
      showOrganizationToast({
        description: 'The message was permanently removed. There is no archive or trash.',
        title: 'Message deleted',
      })
      return true
    }

    if (
      options.mailbox.displayedHeaders.value.some((header) => header.mailId === previousSelection)
    ) {
      options.mailbox.selectedMailId.value = previousSelection
    }
    showMutationFailure(
      'delete-mail',
      outcome.error ?? new Error('Another mail action is still in progress.'),
    )
    return true
  }

  function openLabelManagement() {
    createLabelFeedback.value = ''
    labelManagementOpen.value = true
  }

  function openLabelAssignment() {
    const detail = options.mailbox.displayedDetail.value
    if (!detail || detail.mailId !== options.mailbox.selectedMailId.value) return
    assignmentFeedback.value = ''
    labelAssignmentOpen.value = true
  }

  async function createLabel() {
    const characterId = options.characterId.value
    const name = labelName.value.trim()
    if (!characterId || name.length < 1 || name.length > 40) return
    createLabelFeedback.value = ''
    const outcome = await options.mutations.createMailLabel({
      characterId,
      name,
      ...(labelColor.value === undefined ? {} : { color: labelColor.value }),
    })
    if (!scopeActive || options.characterId.value !== characterId) return
    if (outcome.success) {
      if (outcome.reusedDeletedLabelId !== undefined) {
        options.mailbox.resetMailboxView()
        options.mutations.retireReusedDeletedLabel(characterId, outcome.reusedDeletedLabelId)
      }
      labelName.value = ''
      labelColor.value = undefined
      showOrganizationToast({
        description: `${name} is now available for mail assignment.`,
        title: 'Label created',
      })
      return
    }
    if (outcome.error) {
      createLabelFeedback.value =
        outcome.error instanceof Error ? outcome.error.message : 'EVE refused the label creation.'
      showMutationFailure('create-label', outcome.error)
    }
  }

  function requestLabelDeletion(label: MailLabel) {
    const labelId = label.labelId
    if (labelId === null || options.mutations.undeletableLabelIds.value.has(labelId)) {
      return
    }
    const name = label.name?.trim() || `Label #${labelId}`
    openConfirmDialog({
      confirmLabel: 'Delete label',
      description: `Deleting ${name} removes it from every message carrying it. The messages themselves remain in the mailbox.`,
      onConfirm: () => confirmLabelDeletion(labelId, name),
      pending: () =>
        options.mutations.labelPendingIds.value.size > 0 ||
        options.mutations.deleteLabelPendingIds.value.has(labelId),
      pendingLabel: () =>
        options.mutations.labelPendingIds.value.size > 0
          ? 'Waiting for label update...'
          : 'Deleting...',
      title: `Delete ${name}?`,
      tone: 'danger',
    })
  }

  async function confirmLabelDeletion(labelId: number, name: string) {
    const characterId = options.characterId.value
    if (
      !characterId ||
      options.mutations.labelPendingIds.value.size > 0 ||
      options.mutations.deleteLabelPendingIds.value.has(labelId)
    )
      return false
    const outcome = await options.mutations.deleteMailLabel({ characterId, labelId })
    if (!scopeActive || options.characterId.value !== characterId) return true
    if (outcome.success) {
      options.mailbox.removeLoadedLabel(labelId)
      if (options.mailbox.activeLabelId.value === labelId) options.mailbox.selectLabel(null)
      showOrganizationToast({
        description: `${name} was removed from the character and its messages.`,
        title: 'Label deleted',
      })
      return true
    }
    if (outcome.error instanceof ApiQueryError && outcome.error.code === 'MAIL_MUTATION_REJECTED') {
      options.mutations.markLabelUndeletable(labelId)
      showOrganizationToast({
        description: `EVE does not permit deleting ${name}. It remains available for use.`,
        title: 'Label cannot be deleted',
      })
      return true
    }
    if (outcome.error) showMutationFailure('delete-label', outcome.error)
    return true
  }

  async function changeOpenMessageLabel(labelId: number, assigned: boolean) {
    const characterId = options.characterId.value
    const detail = options.mailbox.displayedDetail.value
    if (!characterId || !detail || detail.mailId !== options.mailbox.selectedMailId.value) {
      assignmentFeedback.value = 'Wait for the complete message before changing its labels.'
      return
    }
    const current = detail.labelIds
    if (new Set(current).size !== current.length) {
      assignmentFeedback.value = 'A mail can carry at most 25 unique labels.'
      return
    }
    const containsLabel = current.includes(labelId)
    if (containsLabel === assigned) return
    const labels = assigned
      ? [...current, labelId]
      : current.filter((candidate) => candidate !== labelId)
    if (labels.length > 25 || new Set(labels).size !== labels.length) {
      assignmentFeedback.value = 'A mail can carry at most 25 unique labels.'
      return
    }

    assignmentFeedback.value = ''
    const outcome = await options.mutations.assignMailLabels({
      characterId,
      header: detail,
      labels,
    })
    if (!scopeActive || options.characterId.value !== characterId) return
    if (outcome.error) {
      assignmentFeedback.value =
        outcome.error instanceof Error ? outcome.error.message : 'The label change was refused.'
      showMutationFailure('assign-label', outcome.error)
    }
  }

  watch(
    [
      options.mailbox.selectedMailId,
      () => options.mailbox.detailQuery.data.value,
      () => options.mailbox.detailQuery.error.value,
    ],
    ([mailId, detail, detailFailure], _previous, onCleanup) => {
      cancelReadDwell?.()
      cancelReadDwell = undefined
      if (autoReadSuppressedMailId.value !== mailId) autoReadSuppressedMailId.value = null
      if (
        mailId === null ||
        autoReadSuppressedMailId.value === mailId ||
        detailFailure ||
        detail?.mailId !== mailId
      )
        return

      cancelReadDwell = scheduleMailReadDwell(() => {
        cancelReadDwell = undefined
        const header = options.mailbox.selectedHeader.value
        if (header?.mailId === mailId && isMailUnread(header.isRead)) {
          void changeMailRead(header, true, false)
        }
      })
      onCleanup(() => cancelReadDwell?.())
    },
    { flush: 'sync' },
  )

  watch(options.mailbox.activeLabelId, resetOrganizationView, { flush: 'sync' })
  watch(options.mailbox.selectedMailId, () => {
    labelAssignmentOpen.value = false
    assignmentFeedback.value = ''
  })
  watch(
    options.characterId,
    () => {
      resetOrganizationView()
      labelManagementOpen.value = false
      labelAssignmentOpen.value = false
      labelName.value = ''
      labelColor.value = undefined
      createLabelFeedback.value = ''
      assignmentFeedback.value = ''
      options.mutations.resetMailMutations()
    },
    { flush: 'sync' },
  )

  onBeforeUnmount(() => {
    scopeActive = false
    if (organizationToastKey !== undefined) dismissToast(organizationToastKey)
    resetOrganizationView()
  })

  return {
    assignedLabelIds,
    assignmentFeedback,
    changeOpenMessageLabel,
    changeOpenMessageRead,
    createLabel,
    createLabelFeedback,
    labelAssignmentOpen,
    labelColor,
    labelManagementOpen,
    labelName,
    mutationPending,
    openLabelAssignment,
    openLabelManagement,
    requestLabelDeletion,
    requestMailDeletion,
  }
}
