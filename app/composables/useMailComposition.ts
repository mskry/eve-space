import { computed, onBeforeUnmount, type ComputedRef } from 'vue'
import type { ApiClient } from '../utils/api-client'
import { MAIL_BODY_LIMIT, MAIL_SUBJECT_LIMIT } from '../utils/mail-composition'
import { useMailCompositionDraft, type MailCompositionMailbox } from './mail-composition-draft'
import { useMailCompositionSubmission } from './mail-composition-submission'

interface MailCompositionOptions {
  apiClient: ApiClient
  authenticated: ComputedRef<boolean>
  authenticationReady: ComputedRef<boolean>
  characterId: ComputedRef<number | undefined>
  mailbox: MailCompositionMailbox
  ownsCharacter: ComputedRef<boolean>
}

export function useMailComposition(options: MailCompositionOptions) {
  const { closeConfirmDialog, openConfirmDialog } = useConfirmDialog()
  const { dismissToast, showToast } = useToast()
  let toastKey: number | undefined
  let preserveToastOnDispose = false
  let submission: ReturnType<typeof useMailCompositionSubmission> | undefined
  const sending = computed(() => submission?.sending.value ?? false)

  function showCompositionToast(toast: Parameters<typeof showToast>[0], preserve = false) {
    toastKey = showToast(toast)
    preserveToastOnDispose = preserve
  }

  const draft = useMailCompositionDraft({
    ...options,
    onReset: () => submission?.resetSubmissionState(),
    openConfirmDialog,
    sending,
    showToast: showCompositionToast,
  })
  submission = useMailCompositionSubmission({
    apiClient: options.apiClient,
    characterId: options.characterId,
    draft,
    openConfirmDialog,
    showToast: showCompositionToast,
  })

  function resetPrivateState() {
    closeConfirmDialog()
    draft.resetDraft()
    if (toastKey !== undefined) {
      dismissToast(toastKey)
    }
    toastKey = undefined
    preserveToastOnDispose = false
  }

  onBeforeUnmount(() => {
    draft.dispose()
    if (toastKey !== undefined && !preserveToastOnDispose) {
      dismissToast(toastKey)
    }
  })

  return {
    addRecipient: draft.addRecipient,
    body: draft.body,
    bodyRemaining: computed(() => MAIL_BODY_LIMIT - draft.body.value.length),
    canReply: draft.canReply,
    chargeRecoveryAvailable: submission.chargeRecoveryAvailable,
    dirty: draft.dirty,
    feedback: draft.feedback,
    mode: draft.mode,
    omitted: draft.omitted,
    open: draft.open,
    openForward: draft.openForward,
    openNew: draft.openNew,
    openReply: draft.openReply,
    openReplyAll: draft.openReplyAll,
    recipientInput: draft.recipientInput,
    recipientSuggestions: draft.recipientSuggestions,
    recipients: draft.recipients,
    recoverCharge: submission.recoverCharge,
    removeRecipient: draft.removeRecipient,
    replyUnavailableReason: draft.replyUnavailableReason,
    requestClose: draft.requestClose,
    resetPrivateState,
    resolveRecipient: draft.resolveRecipient,
    resolving: draft.resolving,
    searchAuthorization: draft.searchAuthorization,
    searchFeedback: draft.searchFeedback,
    searching: draft.searching,
    send: submission.send,
    sendAuthorizationMessage: submission.sendAuthorizationMessage,
    sendAuthorizationUrl: submission.sendAuthorizationUrl,
    sendDisabledReason: submission.sendDisabledReason,
    sending: submission.sending,
    subject: draft.subject,
    subjectRemaining: computed(() => MAIL_SUBJECT_LIMIT - draft.subject.value.length),
  }
}
