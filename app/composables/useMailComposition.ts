import { useMutation, useQuery } from '@pinia/colada'
import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import {
  calculateMailCspaMutation,
  resolveMailRecipientsQuery,
  searchMailRecipientsQuery,
  sendMailMutation,
  type MailDetail,
  type MailRecipient,
} from '../queries/mail'
import { canRunProtectedQuery } from '../queries/query-cache'
import type { ApiClient } from '../utils/api-client'
import { mailPartyName } from '../utils/mail-view'
import { ApiQueryError } from '../utils/query-error'
import type { useCharacterMailbox } from './useCharacterMailbox'

export const MAIL_RECIPIENT_LIMIT = 50
export const MAIL_SUBJECT_LIMIT = 1_000
export const MAIL_BODY_LIMIT = 10_000
export const MAIL_RECIPIENT_RESOLUTION_MIN_LENGTH = 1
export const MAIL_RECIPIENT_SEARCH_MIN_LENGTH = 3

export type MailCompositionMode = 'forward' | 'new' | 'reply' | 'reply-all'

interface MailCompositionSeed {
  body: string
  omitted: string[]
  recipients: MailRecipient[]
  subject: string
}

interface MailCompositionOptions {
  apiClient: ApiClient
  authenticated: ComputedRef<boolean>
  characterId: ComputedRef<number | undefined>
  mailbox: ReturnType<typeof useCharacterMailbox>
}

function recipientKey(recipient: Pick<MailRecipient, 'id' | 'type'>) {
  return `${recipient.type}:${recipient.id}`
}

function addressableParty(party: MailDetail['sender']): party is MailRecipient {
  return Boolean(party && party.type !== 'unknown')
}

function prefixedSubject(subject: string | null, mode: 'forward' | 'reply') {
  const value = subject?.trim() || '(No subject)'
  const prefix = mode === 'reply' ? 'Re:' : 'Fwd:'
  return value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? value
    : `${prefix} ${value}`
}

function quotedBody(detail: MailDetail) {
  const sender = mailPartyName(detail.sender, 'sender')
  return `\n\n--- Original message from ${sender} ---\n${detail.body ?? ''}`
}

export function seedMailComposition(
  mode: Exclude<MailCompositionMode, 'new'>,
  detail: MailDetail,
  characterId: number,
): MailCompositionSeed {
  const omitted: string[] = []
  const recipients: MailRecipient[] = []
  const seen = new Set<string>()
  const add = (party: MailDetail['sender']) => {
    if (!party) return
    if (!addressableParty(party)) {
      omitted.push(mailPartyName(party, 'sender'))
      return
    }
    if (party.type === 'character' && party.id === characterId) return
    const key = recipientKey(party)
    if (seen.has(key)) return
    seen.add(key)
    recipients.push(party)
  }

  if (mode !== 'forward') add(detail.sender)
  if (mode === 'reply-all') {
    for (const recipient of detail.recipients) add(recipient)
  }

  return {
    body: quotedBody(detail),
    omitted,
    recipients,
    subject: prefixedSubject(detail.subject, mode === 'forward' ? 'forward' : 'reply'),
  }
}

export function useMailComposition(options: MailCompositionOptions) {
  const { openConfirmDialog } = useConfirmDialog()
  const { dismissToast, showToast } = useToast()
  const open = ref(false)
  const mode = ref<MailCompositionMode>('new')
  const recipients = ref<MailRecipient[]>([])
  const subject = ref('')
  const body = ref('')
  const recipientInput = ref('')
  const exactName = ref<string | null>(null)
  const searchQuery = ref('')
  const feedback = ref('')
  const omitted = ref<string[]>([])
  const deliveryUnknown = ref(false)
  const chargeRecoveryAvailable = ref(false)
  const sendAuthorizationMessage = ref('')
  const sendAuthorizationUrl = ref('')
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let toastKey: number | undefined
  let preserveToastOnDispose = false
  let generation = 0
  let scopeActive = true

  const queryEnabled = () =>
    canRunProtectedQuery(import.meta.client, options.authenticated.value, options.characterId.value)

  const resolveQuery = useQuery(() => ({
    ...resolveMailRecipientsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      names: exactName.value ? [exactName.value] : [],
    }),
    enabled:
      exactName.value !== null &&
      exactName.value.length >= MAIL_RECIPIENT_RESOLUTION_MIN_LENGTH &&
      queryEnabled(),
  }))
  const searchQueryResult = useQuery(() => ({
    ...searchMailRecipientsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      query: searchQuery.value,
    }),
    enabled: searchQuery.value.length >= MAIL_RECIPIENT_SEARCH_MIN_LENGTH && queryEnabled(),
  }))
  const sendMutation = useMutation({
    mutation: (input: Parameters<typeof sendMailMutation>[0]) => sendMailMutation(input),
  })
  const cspaMutation = useMutation({
    mutation: (input: Parameters<typeof calculateMailCspaMutation>[0]) =>
      calculateMailCspaMutation(input),
  })

  const dirty = computed(
    () => recipients.value.length > 0 || subject.value.length > 0 || body.value.length > 0,
  )
  const sending = computed(
    () =>
      sendMutation.asyncStatus.value === 'loading' || cspaMutation.asyncStatus.value === 'loading',
  )
  const resolving = computed(() => resolveQuery.asyncStatus.value === 'loading')
  const searching = computed(() => searchQueryResult.asyncStatus.value === 'loading')
  const canReply = computed(() => {
    const detail = currentDetail()
    return Boolean(detail && addressableParty(detail.sender))
  })
  const replyUnavailableReason = computed(() =>
    currentDetail() && !canReply.value
      ? 'The sender type could not be resolved, so EVE cannot address a reply safely.'
      : '',
  )
  const localMailingListSuggestions = computed<MailRecipient[]>(() => {
    const needle = recipientInput.value.trim().toLocaleLowerCase()
    if (!needle) return []
    return options.mailbox.mailingLists.value
      .filter((list) => list.name.toLocaleLowerCase().includes(needle))
      .map((list) => ({
        id: list.mailingListId,
        name: list.name,
        type: 'mailing_list' as const,
      }))
  })
  const remoteSuggestions = computed(() => searchQueryResult.data.value?.recipients ?? [])
  const recipientSuggestions = computed(() => {
    const selected = new Set(recipients.value.map(recipientKey))
    const available = new Map<string, MailRecipient>()
    for (const recipient of [...localMailingListSuggestions.value, ...remoteSuggestions.value]) {
      const key = recipientKey(recipient)
      if (!selected.has(key)) available.set(key, recipient)
    }
    return [...available.values()]
  })
  const searchAuthorization = computed(() => {
    const error = searchQueryResult.error.value
    return error instanceof ApiQueryError &&
      (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
      ? error
      : undefined
  })
  const searchFeedback = computed(() => {
    const error = searchQueryResult.error.value
    return error instanceof Error ? error.message : ''
  })
  const sendDisabledReason = computed(() => {
    if (deliveryUnknown.value)
      return 'Check Sent mail before taking another action on this message.'
    if (sending.value) return 'Sending mail...'
    if (recipients.value.length === 0) return 'Add at least one recipient.'
    if (recipients.value.length > MAIL_RECIPIENT_LIMIT)
      return `Mail accepts at most ${MAIL_RECIPIENT_LIMIT} recipients.`
    if (subject.value.length > MAIL_SUBJECT_LIMIT)
      return `Subject exceeds the ${MAIL_SUBJECT_LIMIT}-character limit.`
    if (body.value.length > MAIL_BODY_LIMIT)
      return `Body exceeds the ${MAIL_BODY_LIMIT}-character limit.`
    return ''
  })

  function currentDetail() {
    const detail = options.mailbox.detailQuery.data.value
    return detail?.mailId === options.mailbox.selectedMailId.value ? detail : undefined
  }

  function resetDraft() {
    generation += 1
    open.value = false
    mode.value = 'new'
    recipients.value = []
    subject.value = ''
    body.value = ''
    recipientInput.value = ''
    exactName.value = null
    searchQuery.value = ''
    feedback.value = ''
    omitted.value = []
    deliveryUnknown.value = false
    chargeRecoveryAvailable.value = false
    sendAuthorizationMessage.value = ''
    sendAuthorizationUrl.value = ''
  }

  function openNew() {
    resetDraft()
    open.value = true
  }

  function openSeeded(nextMode: Exclude<MailCompositionMode, 'new'>) {
    const detail = currentDetail()
    const characterId = options.characterId.value
    if (!detail || !characterId) return
    if (nextMode === 'reply' && !addressableParty(detail.sender)) {
      feedback.value = replyUnavailableReason.value
      showCompositionToast({
        description: replyUnavailableReason.value,
        title: 'Reply unavailable',
      })
      return
    }
    resetDraft()
    const seed = seedMailComposition(nextMode, detail, characterId)
    mode.value = nextMode
    recipients.value = seed.recipients
    subject.value = seed.subject
    body.value = seed.body
    omitted.value = seed.omitted
    open.value = true
  }

  function addRecipient(recipient: MailRecipient) {
    if (recipients.value.some((candidate) => recipientKey(candidate) === recipientKey(recipient))) {
      recipientInput.value = ''
      return
    }
    if (recipients.value.length >= MAIL_RECIPIENT_LIMIT) {
      feedback.value = `Mail accepts at most ${MAIL_RECIPIENT_LIMIT} recipients.`
      return
    }
    recipients.value = [...recipients.value, recipient]
    recipientInput.value = ''
    exactName.value = null
    feedback.value = ''
  }

  function removeRecipient(recipient: MailRecipient) {
    const key = recipientKey(recipient)
    recipients.value = recipients.value.filter((candidate) => recipientKey(candidate) !== key)
  }

  function resolveRecipient() {
    const name = recipientInput.value.trim()
    if (name.length < MAIL_RECIPIENT_RESOLUTION_MIN_LENGTH) {
      feedback.value = 'Enter a recipient name.'
      return
    }
    const local = options.mailbox.mailingLists.value.find(
      (list) => list.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
    if (local) {
      addRecipient({ id: local.mailingListId, name: local.name, type: 'mailing_list' })
      return
    }
    if (!queryEnabled()) return
    feedback.value = ''
    if (exactName.value === name) void resolveQuery.refetch()
    else exactName.value = name
  }

  function requestClose() {
    if (!open.value) return
    if (!dirty.value) {
      resetDraft()
      return
    }
    let discarded = false
    openConfirmDialog({
      confirmLabel: 'Discard draft',
      description: 'The recipients, subject, and message body will be permanently discarded.',
      onClose: () => {
        if (!discarded) open.value = true
      },
      onConfirm: () => {
        discarded = true
        resetDraft()
      },
      title: 'Discard this mail draft?',
      tone: 'danger',
    })
  }

  async function send() {
    const characterId = options.characterId.value
    if (!characterId || sendDisabledReason.value) return
    const operationGeneration = generation
    feedback.value = ''
    chargeRecoveryAvailable.value = false
    sendAuthorizationMessage.value = ''
    sendAuthorizationUrl.value = ''
    const characterRecipients = recipients.value
      .filter((recipient) => recipient.type === 'character')
      .map((recipient) => recipient.id)
    if (characterRecipients.length === 0) {
      await submitMail(characterId, 0, operationGeneration)
      return
    }

    try {
      const approvedCost = await cspaMutation.mutateAsync({
        apiClient: options.apiClient,
        characterId,
        recipientIds: characterRecipients,
      })
      if (!scopeActive || operationGeneration !== generation) return
      if (approvedCost === 0) {
        await submitMail(characterId, 0, operationGeneration)
        return
      }
      const approvedIntegerCost = Math.ceil(approvedCost)
      openConfirmDialog({
        confirmLabel: 'Approve cost and send',
        description: `EVE will charge ${formatIsk(approvedIntegerCost)} ISK to deliver this mail.`,
        onConfirm: async () => {
          await submitMail(characterId, approvedIntegerCost, operationGeneration)
        },
        pending: sending,
        pendingLabel: 'Sending...',
        title: 'Approve recipient charge?',
      })
    } catch (error) {
      if (!scopeActive || operationGeneration !== generation) return
      feedback.value = 'The recipient charge could not be determined.'
      showAuthorizationToast(error, 'Mail charge authorization required')
      openConfirmDialog({
        confirmLabel: 'Send without approval',
        description:
          'The recipient charge is unknown. Sending with no approved cost may be refused by EVE.',
        onConfirm: async () => {
          await submitMail(characterId, 0, operationGeneration)
        },
        pending: sending,
        pendingLabel: 'Sending...',
        title: 'Send with unknown charge?',
      })
    }
  }

  async function recoverCharge() {
    const characterId = options.characterId.value
    if (!characterId || sendDisabledReason.value) return
    const operationGeneration = generation
    const characterRecipients = recipients.value
      .filter((recipient) => recipient.type === 'character')
      .map((recipient) => recipient.id)
    chargeRecoveryAvailable.value = false
    if (characterRecipients.length === 0) {
      feedback.value = 'Only character recipients can carry a recipient charge.'
      return
    }

    feedback.value = ''
    try {
      const approvedCost = await cspaMutation.mutateAsync({
        apiClient: options.apiClient,
        characterId,
        recipientIds: characterRecipients,
      })
      if (!scopeActive || operationGeneration !== generation) return
      if (approvedCost === 0) {
        feedback.value = 'No recipient charge applies. The message was refused for another reason.'
        return
      }
      const approvedIntegerCost = Math.ceil(approvedCost)
      openConfirmDialog({
        confirmLabel: 'Approve cost and send',
        description: `EVE will charge ${formatIsk(approvedIntegerCost)} ISK to deliver this mail.`,
        onConfirm: async () => {
          await submitMail(characterId, approvedIntegerCost, operationGeneration)
        },
        pending: sending,
        pendingLabel: 'Sending...',
        title: 'Approve recipient charge?',
      })
    } catch (error) {
      if (!scopeActive || operationGeneration !== generation) return
      feedback.value = 'The recipient charge could not be determined.'
      showAuthorizationToast(error, 'Mail charge authorization required')
    }
  }

  async function submitMail(
    characterId: number,
    approvedCost: number,
    operationGeneration: number,
  ) {
    try {
      await sendMutation.mutateAsync({
        apiClient: options.apiClient,
        approvedCost,
        body: body.value,
        characterId,
        recipients: recipients.value.map(({ id, type }) => ({ id, type })),
        subject: subject.value,
      })
      if (!scopeActive || operationGeneration !== generation) return
      resetDraft()
      showCompositionToast({
        description: 'The message was accepted by EVE.',
        title: 'Mail sent',
      })
    } catch (error) {
      if (!scopeActive || operationGeneration !== generation) return
      handleSendFailure(error)
    }
  }

  function handleSendFailure(error: unknown) {
    if (error instanceof ApiQueryError && error.code === 'MAIL_DELIVERY_UNKNOWN') {
      deliveryUnknown.value = true
      feedback.value = error.message
      showCompositionToast(
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
      feedback.value = error.message
      sendAuthorizationMessage.value = error.message
      sendAuthorizationUrl.value = error.authorizeUrl ?? ''
      showAuthorizationToast(error, 'Mail sending authorization required')
      return
    }
    if (error instanceof ApiQueryError && error.code === 'MAIL_REJECTED') {
      feedback.value = `The message was refused. ${error.message}`
      chargeRecoveryAvailable.value = recipients.value.some(
        (recipient) => recipient.type === 'character',
      )
      return
    }
    feedback.value = error instanceof Error ? error.message : 'The message could not be sent.'
  }

  function showAuthorizationToast(error: unknown, title: string) {
    if (
      !(error instanceof ApiQueryError) ||
      (error.code !== 'EVE_SCOPE_REQUIRED' && error.code !== 'EVE_REAUTH_REQUIRED')
    )
      return
    showCompositionToast({
      ...(error.authorizeUrl
        ? { actionHref: error.authorizeUrl, actionLabel: 'Authorize character' }
        : {}),
      description: error.message,
      duration: Number.POSITIVE_INFINITY,
      title,
    })
  }

  function showCompositionToast(toast: Parameters<typeof showToast>[0], preserve = false) {
    toastKey = showToast(toast)
    preserveToastOnDispose = preserve
  }

  watch(recipientInput, (value) => {
    if (searchTimer) clearTimeout(searchTimer)
    const normalized = value.trim()
    if (normalized.length < MAIL_RECIPIENT_SEARCH_MIN_LENGTH) {
      searchQuery.value = ''
      return
    }
    searchTimer = setTimeout(() => {
      searchQuery.value = normalized
    }, 250)
  })

  watch(
    () => resolveQuery.data.value,
    (result) => {
      if (!result || exactName.value === null) return
      const recipient = result.recipients[0]
      if (recipient) addRecipient(recipient)
      else feedback.value = `No mail recipient named "${exactName.value}" was found.`
      exactName.value = null
    },
  )

  watch(
    () => resolveQuery.error.value,
    (error) => {
      if (!error || exactName.value === null) return
      feedback.value =
        error instanceof Error ? error.message : 'The recipient could not be resolved.'
      exactName.value = null
    },
  )

  watch(options.characterId, resetDraft, { flush: 'sync' })

  onBeforeUnmount(() => {
    scopeActive = false
    if (searchTimer) clearTimeout(searchTimer)
    if (toastKey !== undefined && !preserveToastOnDispose) dismissToast(toastKey)
  })

  return {
    addRecipient,
    body,
    bodyRemaining: computed(() => MAIL_BODY_LIMIT - body.value.length),
    canReply,
    chargeRecoveryAvailable,
    dirty,
    feedback,
    mode,
    omitted,
    open,
    openForward: () => openSeeded('forward'),
    openNew,
    openReply: () => openSeeded('reply'),
    openReplyAll: () => openSeeded('reply-all'),
    recipientInput,
    recipientSuggestions,
    recipients,
    recoverCharge,
    removeRecipient,
    replyUnavailableReason,
    requestClose,
    resolveRecipient,
    resolving,
    searchAuthorization,
    searchFeedback,
    searching,
    send,
    sendDisabledReason,
    sendAuthorizationMessage,
    sendAuthorizationUrl,
    sending,
    subject,
    subjectRemaining: computed(() => MAIL_SUBJECT_LIMIT - subject.value.length),
  }
}

function formatIsk(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}
