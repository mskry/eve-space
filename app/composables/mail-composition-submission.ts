import { useMutation, useQueryCache } from '@pinia/colada'
import { computed, ref, type ComputedRef } from 'vue'
import { calculateMailCspaMutation, sendMailMutation, type MailRecipient } from '../queries/mail'
import { reportPrivateQueryAuthorizationDenial } from '../query-persistence/runtime'
import type { ApiClient } from '../utils/api-client'
import {
  MAIL_BODY_LIMIT,
  MAIL_RECIPIENT_LIMIT,
  MAIL_SUBJECT_LIMIT,
} from '../utils/mail-composition'
import { ApiQueryError } from '../utils/query-error'
import type { useMailCompositionDraft } from './mail-composition-draft'

interface MailSubmissionOptions {
  apiClient: ApiClient
  characterId: ComputedRef<number | undefined>
  draft: ReturnType<typeof useMailCompositionDraft>
  openConfirmDialog: ReturnType<typeof useConfirmDialog>['openConfirmDialog']
  showToast: (
    toast: Parameters<ReturnType<typeof useToast>['showToast']>[0],
    preserve?: boolean,
  ) => void
}

type MailSubmission = Pick<
  Parameters<typeof sendMailMutation>[0],
  'body' | 'recipients' | 'subject'
>

export function useMailCompositionSubmission(options: MailSubmissionOptions) {
  const queryCache = useQueryCache()
  const deliveryUnknown = ref(false)
  const chargeRecoveryAvailable = ref(false)
  const sendAuthorizationMessage = ref('')
  const sendAuthorizationUrl = ref('')
  const sendMutation = useMutation({
    mutation: (input: Parameters<typeof sendMailMutation>[0]) => sendMailMutation(input),
  })
  const cspaMutation = useMutation({
    mutation: (input: Parameters<typeof calculateMailCspaMutation>[0]) =>
      calculateMailCspaMutation(input),
  })
  const sending = computed(
    () =>
      sendMutation.asyncStatus.value === 'loading' || cspaMutation.asyncStatus.value === 'loading',
  )
  const sendDisabledReason = computed(() => {
    if (deliveryUnknown.value) {
      return 'Check Sent mail before taking another action on this message.'
    }
    if (sending.value) {
      return 'Sending mail...'
    }
    if (options.draft.recipients.value.length === 0) {
      return 'Add at least one recipient.'
    }
    if (options.draft.recipients.value.length > MAIL_RECIPIENT_LIMIT) {
      return `Mail accepts at most ${MAIL_RECIPIENT_LIMIT} recipients.`
    }
    if (options.draft.subject.value.length > MAIL_SUBJECT_LIMIT) {
      return `Subject exceeds the ${MAIL_SUBJECT_LIMIT}-character limit.`
    }
    if (options.draft.body.value.length > MAIL_BODY_LIMIT) {
      return `Body exceeds the ${MAIL_BODY_LIMIT}-character limit.`
    }
    return ''
  })

  function resetOutcomes() {
    deliveryUnknown.value = false
    chargeRecoveryAvailable.value = false
    sendAuthorizationMessage.value = ''
    sendAuthorizationUrl.value = ''
  }

  function resetSubmissionState() {
    resetOutcomes()
    sendMutation.reset()
    cspaMutation.reset()
  }

  async function send() {
    const characterId = options.characterId.value
    if (!characterId || sendDisabledReason.value) {
      return
    }
    const operationGeneration = options.draft.captureGeneration()
    options.draft.feedback.value = ''
    chargeRecoveryAvailable.value = false
    sendAuthorizationMessage.value = ''
    sendAuthorizationUrl.value = ''
    const submission = currentSubmission(options.draft)
    const characterRecipients = characterRecipientIds(submission.recipients)
    if (characterRecipients.length === 0) {
      await submitMail(characterId, 0, operationGeneration, submission)
      return
    }

    try {
      const approvedCost = await cspaMutation.mutateAsync({
        apiClient: options.apiClient,
        characterId,
        recipientIds: characterRecipients,
      })
      if (!options.draft.isCurrent(operationGeneration)) {
        return
      }
      if (approvedCost === 0) {
        await submitMail(characterId, 0, operationGeneration, submission)
        return
      }
      confirmChargedSubmission(
        characterId,
        Math.ceil(approvedCost),
        operationGeneration,
        submission,
      )
    } catch (error) {
      if (!reportFailure(characterId, operationGeneration, error)) {
        return
      }
      showAuthorizationToast(error, 'Mail charge authorization required')
      if (!options.draft.isCurrent(operationGeneration)) {
        return
      }
      options.draft.feedback.value = 'The recipient charge could not be determined.'
      options.openConfirmDialog({
        confirmLabel: 'Send without approval',
        description:
          'The recipient charge is unknown. Sending with no approved cost may be refused by EVE.',
        onConfirm: async () => {
          await submitMail(characterId, 0, operationGeneration, submission)
        },
        pending: sending,
        pendingLabel: 'Sending...',
        title: 'Send with unknown charge?',
      })
    }
  }

  async function recoverCharge() {
    const characterId = options.characterId.value
    if (!characterId || sendDisabledReason.value) {
      return
    }
    const operationGeneration = options.draft.captureGeneration()
    const submission = currentSubmission(options.draft)
    const characterRecipients = characterRecipientIds(submission.recipients)
    chargeRecoveryAvailable.value = false
    if (characterRecipients.length === 0) {
      options.draft.feedback.value = 'Only character recipients can carry a recipient charge.'
      return
    }

    options.draft.feedback.value = ''
    try {
      const approvedCost = await cspaMutation.mutateAsync({
        apiClient: options.apiClient,
        characterId,
        recipientIds: characterRecipients,
      })
      if (!options.draft.isCurrent(operationGeneration)) {
        return
      }
      if (approvedCost === 0) {
        options.draft.feedback.value =
          'No recipient charge applies. The message was refused for another reason.'
        return
      }
      confirmChargedSubmission(
        characterId,
        Math.ceil(approvedCost),
        operationGeneration,
        submission,
      )
    } catch (error) {
      if (!reportFailure(characterId, operationGeneration, error)) {
        return
      }
      options.draft.feedback.value = 'The recipient charge could not be determined.'
      showAuthorizationToast(error, 'Mail charge authorization required')
    }
  }

  function confirmChargedSubmission(
    characterId: number,
    approvedCost: number,
    operationGeneration: number,
    submission: MailSubmission,
  ) {
    options.openConfirmDialog({
      confirmLabel: 'Approve cost and send',
      description: `EVE will charge ${formatIsk(approvedCost)} ISK to deliver this mail.`,
      onConfirm: async () => {
        await submitMail(characterId, approvedCost, operationGeneration, submission)
      },
      pending: sending,
      pendingLabel: 'Sending...',
      title: 'Approve recipient charge?',
    })
  }

  async function submitMail(
    characterId: number,
    approvedCost: number,
    operationGeneration: number,
    submission: MailSubmission,
  ) {
    if (!options.draft.isCurrent(operationGeneration)) {
      return
    }
    try {
      await sendMutation.mutateAsync({
        apiClient: options.apiClient,
        approvedCost,
        characterId,
        ...submission,
      })
      if (!options.draft.isCurrent(operationGeneration)) {
        return
      }
      options.draft.resetDraft()
      options.showToast({
        description: 'The message was accepted by EVE.',
        title: 'Mail sent',
      })
    } catch (error) {
      if (reportFailure(characterId, operationGeneration, error)) {
        handleSendFailure(error)
      }
    }
  }

  function handleSendFailure(error: unknown) {
    if (error instanceof ApiQueryError && error.code === 'MAIL_DELIVERY_UNKNOWN') {
      deliveryUnknown.value = true
      options.draft.feedback.value = error.message
      options.showToast(
        {
          description: error.message,
          duration: Number.POSITIVE_INFINITY,
          title: 'Mail delivery unconfirmed',
        },
        true,
      )
      return
    }
    if (
      error instanceof ApiQueryError &&
      (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
    ) {
      options.draft.feedback.value = error.message
      sendAuthorizationMessage.value = error.message
      sendAuthorizationUrl.value = error.authorizeUrl ?? ''
      showAuthorizationToast(error, 'Mail sending authorization required')
      return
    }
    if (error instanceof ApiQueryError && error.code === 'MAIL_REJECTED') {
      options.draft.feedback.value = `The message was refused. ${error.message}`
      chargeRecoveryAvailable.value = options.draft.recipients.value.some(
        (recipient) => recipient.type === 'character',
      )
      return
    }
    options.draft.feedback.value =
      error instanceof Error ? error.message : 'The message could not be sent.'
  }

  function showAuthorizationToast(error: unknown, title: string) {
    if (
      !(error instanceof ApiQueryError) ||
      (error.code !== 'EVE_SCOPE_REQUIRED' && error.code !== 'EVE_REAUTH_REQUIRED')
    ) {
      return
    }
    options.showToast({
      ...(error.authorizeUrl
        ? { actionHref: error.authorizeUrl, actionLabel: 'Authorize character' }
        : {}),
      description: error.message,
      duration: Number.POSITIVE_INFINITY,
      title,
    })
  }

  // Reporting a denial can synchronously reset the draft, so currency is read first.
  function reportFailure(characterId: number, operationGeneration: number, error: unknown) {
    const current = options.draft.isCurrent(operationGeneration)
    reportPrivateQueryAuthorizationDenial(queryCache, { characterId, kind: 'character' }, error)
    return current
  }

  return {
    chargeRecoveryAvailable,
    deliveryUnknown,
    recoverCharge,
    resetOutcomes,
    resetSubmissionState,
    send,
    sendAuthorizationMessage,
    sendAuthorizationUrl,
    sendDisabledReason,
    sending,
  }
}

function currentSubmission(draft: ReturnType<typeof useMailCompositionDraft>): MailSubmission {
  return {
    body: draft.body.value,
    recipients: draft.recipients.value.map(({ id, type }) => ({ id, type })),
    subject: draft.subject.value,
  }
}

function characterRecipientIds(recipients: readonly Pick<MailRecipient, 'id' | 'type'>[]) {
  return recipients.filter(({ type }) => type === 'character').map(({ id }) => id)
}

function formatIsk(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}
