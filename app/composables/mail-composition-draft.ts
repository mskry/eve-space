import { useQuery } from '@pinia/colada'
import { computed, ref, watch, type ComputedRef } from 'vue'
import {
  resolveMailRecipientsQuery,
  searchMailRecipientsQuery,
  type MailRecipient,
} from '../queries/mail'
import { canRunProtectedCharacterQuery } from '../queries/protected-character-query-access'
import type { ApiClient } from '../utils/api-client'
import type { MailCompositionMode } from '../types/mail-composition'
import {
  addressableMailParty,
  mailRecipientKey,
  MAIL_RECIPIENT_LIMIT,
  MAIL_RECIPIENT_RESOLUTION_MIN_LENGTH,
  MAIL_RECIPIENT_SEARCH_MIN_LENGTH,
  seedMailComposition,
} from '../utils/mail-composition'
import { ApiQueryError } from '../utils/query-error'
import type { useCharacterMailbox } from './useCharacterMailbox'

type CharacterMailbox = ReturnType<typeof useCharacterMailbox>

export interface MailCompositionMailbox {
  readonly detailQuery: { readonly data: Pick<CharacterMailbox['detailQuery']['data'], 'value'> }
  readonly mailingLists: Pick<CharacterMailbox['mailingLists'], 'value'>
  readonly selectedMailId: Pick<CharacterMailbox['selectedMailId'], 'value'>
}

interface MailDraftOptions {
  apiClient: ApiClient
  authenticated: ComputedRef<boolean>
  authenticationReady: ComputedRef<boolean>
  characterId: ComputedRef<number | undefined>
  mailbox: MailCompositionMailbox
  onReset: () => void
  openConfirmDialog: ReturnType<typeof useConfirmDialog>['openConfirmDialog']
  ownsCharacter: ComputedRef<boolean>
  sending: ComputedRef<boolean>
  showToast: (toast: Parameters<ReturnType<typeof useToast>['showToast']>[0]) => void
}

export function useMailCompositionDraft(options: MailDraftOptions) {
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
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let scopeActive = true

  const queryEnabled = () =>
    canRunProtectedCharacterQuery(
      {
        authenticated: options.authenticated.value,
        authenticationReady: options.authenticationReady.value,
        isClient: import.meta.client,
        ownsCharacter: options.ownsCharacter.value,
      },
      options.characterId.value ?? 0,
    )

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

  const dirty = computed(
    () => recipients.value.length > 0 || subject.value.length > 0 || body.value.length > 0,
  )
  const resolving = computed(() => resolveQuery.asyncStatus.value === 'loading')
  const searching = computed(() => searchQueryResult.asyncStatus.value === 'loading')
  const canReply = computed(() => {
    const detail = currentDetail()
    return Boolean(detail && addressableMailParty(detail.sender))
  })
  const replyUnavailableReason = computed(() =>
    currentDetail() && !canReply.value
      ? 'The sender type could not be resolved, so EVE cannot address a reply safely.'
      : '',
  )
  const localMailingListSuggestions = computed<MailRecipient[]>(() => {
    const needle = recipientInput.value.trim().toLocaleLowerCase()
    if (!needle) {
      return []
    }
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
    const selected = new Set(recipients.value.map(mailRecipientKey))
    const available = new Map<string, MailRecipient>()
    for (const recipient of [...localMailingListSuggestions.value, ...remoteSuggestions.value]) {
      const key = mailRecipientKey(recipient)
      if (!selected.has(key)) {
        available.set(key, recipient)
      }
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
    options.onReset()
  }

  function openNew() {
    resetDraft()
    open.value = true
  }

  function openSeeded(nextMode: Exclude<MailCompositionMode, 'new'>) {
    const detail = currentDetail()
    const characterId = options.characterId.value
    if (!detail || !characterId) {
      return
    }
    if (nextMode === 'reply' && !addressableMailParty(detail.sender)) {
      feedback.value = replyUnavailableReason.value
      options.showToast({
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
    if (
      recipients.value.some(
        (candidate) => mailRecipientKey(candidate) === mailRecipientKey(recipient),
      )
    ) {
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
    const key = mailRecipientKey(recipient)
    recipients.value = recipients.value.filter((candidate) => mailRecipientKey(candidate) !== key)
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
    if (!queryEnabled()) {
      return
    }
    feedback.value = ''
    if (exactName.value === name) {
      void resolveQuery.refetch()
    } else {
      exactName.value = name
    }
  }

  function requestClose() {
    if (!open.value || options.sending.value) {
      return
    }
    if (!dirty.value) {
      resetDraft()
      return
    }
    let discarded = false
    options.openConfirmDialog({
      confirmLabel: 'Discard draft',
      description: 'The recipients, subject, and message body will be permanently discarded.',
      onClose: () => {
        if (!discarded) {
          open.value = true
        }
      },
      onConfirm: () => {
        discarded = true
        resetDraft()
      },
      title: 'Discard this mail draft?',
      tone: 'danger',
    })
  }

  watch(recipientInput, (value) => {
    if (searchTimer) {
      clearTimeout(searchTimer)
    }
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
      if (!result || exactName.value === null) {
        return
      }
      const recipient = result.recipients[0]
      if (recipient) {
        addRecipient(recipient)
      } else {
        feedback.value = `No mail recipient named "${exactName.value}" was found.`
      }
      exactName.value = null
    },
  )

  watch(
    () => resolveQuery.error.value,
    (error) => {
      if (!error || exactName.value === null) {
        return
      }
      feedback.value =
        error instanceof Error ? error.message : 'The recipient could not be resolved.'
      exactName.value = null
    },
  )

  watch(options.characterId, resetDraft, { flush: 'sync' })

  return {
    addRecipient,
    body,
    canReply,
    captureGeneration: () => generation,
    dirty,
    dispose() {
      scopeActive = false
      if (searchTimer) {
        clearTimeout(searchTimer)
      }
    },
    feedback,
    isCurrent: (operationGeneration: number) => scopeActive && operationGeneration === generation,
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
    removeRecipient,
    replyUnavailableReason,
    requestClose,
    resetDraft,
    resolveRecipient,
    resolving,
    searchAuthorization,
    searchFeedback,
    searching,
    subject,
  }
}
