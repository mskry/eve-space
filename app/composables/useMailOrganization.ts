import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import type { MailHeader } from '../queries/mail'
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
  let cancelReadDwell: (() => void) | undefined
  let organizationToastKey: number | undefined
  let scopeActive = true

  const mutationPending = computed(
    () =>
      options.mailbox.selectedMailId.value !== null &&
      (options.mutations.readPendingIds.value.has(options.mailbox.selectedMailId.value) ||
        options.mutations.deletePendingIds.value.has(options.mailbox.selectedMailId.value)),
  )
  function resetOrganizationView() {
    cancelReadDwell?.()
    cancelReadDwell = undefined
    autoReadSuppressedMailId.value = null
  }

  function showOrganizationToast(toast: Parameters<typeof showToast>[0]) {
    organizationToastKey = showToast(toast)
  }

  function showMutationFailure(action: 'delete' | 'read', error: unknown) {
    const fallback =
      action === 'delete' ? 'The message was not deleted.' : 'The read change was reverted.'
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
    showOrganizationToast({
      description: error instanceof Error ? `${fallback} ${error.message}` : fallback,
      title: action === 'delete' ? 'Deletion reverted' : 'Read change reverted',
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
        options.mutations.deletePendingIds.value.has(header.mailId),
      pendingLabel: () =>
        options.mutations.readPendingIds.value.has(header.mailId)
          ? 'Waiting for mail update...'
          : 'Deleting...',
      title: `Delete ${subject}?`,
      tone: 'danger',
    })
  }

  async function confirmMailDeletion(mailId: number) {
    const candidate = options.mailbox.displayedHeaders.value.find(
      (header) => header.mailId === mailId,
    )
    if (!candidate) return true
    if (
      !options.characterId.value ||
      options.mutations.readPendingIds.value.has(mailId) ||
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
      'delete',
      outcome.error ?? new Error('Another mail action is still in progress.'),
    )
    return true
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
  watch(
    options.characterId,
    () => {
      resetOrganizationView()
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
    changeOpenMessageRead,
    mutationPending,
    requestMailDeletion,
  }
}
