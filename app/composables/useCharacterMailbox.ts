import { useQuery } from '@pinia/colada'
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  mailDetailQuery,
  mailHeadersQuery,
  mailingListsQuery,
  mailLabelsQuery,
  type MailHeader,
  type MailLabel,
} from '../queries/mail'
import { canRunProtectedQuery } from '../queries/query-cache'
import type { ApiClient } from '../utils/api-client'
import {
  applyMailOverlays,
  appendUniqueMailHeaders,
  deriveDisplayedMailCounts,
  deriveMailboxStatus,
  filterDisplayedMailHeaders,
  mergePaginatedMailHeaders,
  removeMailLabelIds,
  replaceLatestMailHeaders,
} from '../utils/mail-view'
import { ApiQueryError } from '../utils/query-error'

interface CharacterMailboxOptions {
  apiClient: ApiClient
  authenticated: ComputedRef<boolean>
  characterId: ComputedRef<number | undefined>
  deletedLabelIds: Ref<ReadonlySet<number>>
  deletedMailIds: Ref<Set<number>>
  deletePendingIds: Ref<Set<number>>
  createdLabels: Ref<readonly MailLabel[]>
  labelOverrides: Ref<Map<number, readonly number[]>>
  readStateOverrides: Ref<Map<number, boolean>>
  reconcileCreatedLabels: (labels: readonly MailLabel[]) => void
  reconcileLabelState: (headers: readonly Pick<MailHeader, 'labelIds' | 'mailId'>[]) => void
  reconcileReadState: (headers: readonly MailHeader[]) => void
}

export function useCharacterMailbox(options: CharacterMailboxOptions) {
  const selectedMailId = ref<number | null>(null)
  const activeLabelId = ref<number | null>(null)
  const search = ref('')
  const unreadOnly = ref(false)
  const selectedMailingListId = ref<number | null>(null)
  const loadedHeaders = ref<MailHeader[]>([])
  const nextLastMailId = ref<number | null>(null)
  const requestedCursor = ref<number | null>(null)
  const hasPaginated = ref(false)

  const selectedLabels = computed(() => (activeLabelId.value === null ? [] : [activeLabelId.value]))
  const queryEnabled = () =>
    canRunProtectedQuery(import.meta.client, options.authenticated.value, options.characterId.value)

  const headersQuery = useQuery(() => ({
    ...mailHeadersQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      labels: selectedLabels.value,
    }),
    enabled: queryEnabled(),
  }))
  const labelsQuery = useQuery(() => ({
    ...mailLabelsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
    }),
    enabled: queryEnabled(),
  }))
  const listsQuery = useQuery(() => ({
    ...mailingListsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
    }),
    enabled: queryEnabled(),
  }))
  const cursorQuery = useQuery(() => ({
    ...mailHeadersQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      labels: selectedLabels.value,
      lastMailId: requestedCursor.value,
    }),
    enabled:
      requestedCursor.value !== null &&
      nextLastMailId.value === requestedCursor.value &&
      queryEnabled(),
  }))
  const detailQuery = useQuery(() => ({
    ...mailDetailQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      mailId: selectedMailId.value ?? 0,
    }),
    enabled: selectedMailId.value !== null && queryEnabled(),
  }))

  const overlaidHeaders = computed(() =>
    applyMailOverlays(
      loadedHeaders.value,
      options.readStateOverrides.value,
      options.deletedMailIds.value,
      options.labelOverrides.value,
    ).map((header) => removeMailLabelIds(header, options.deletedLabelIds.value)),
  )
  const displayedHeaders = computed(() => {
    const headers = overlaidHeaders.value
    return activeLabelId.value === null
      ? headers
      : headers.filter((header) => header.labelIds.includes(activeLabelId.value!))
  })
  const retrievedLabels = computed(() => labelsQuery.data.value?.labels ?? [])
  const mergedLabels = computed(() => {
    const retrievedIds = new Set(retrievedLabels.value.map((label) => label.labelId))
    return [
      ...retrievedLabels.value,
      ...options.createdLabels.value.filter((label) => !retrievedIds.has(label.labelId)),
    ].filter((label) => label.labelId === null || !options.deletedLabelIds.value.has(label.labelId))
  })
  const displayedCounts = computed(() =>
    deriveDisplayedMailCounts({
      deletedMailIds: options.deletePendingIds.value,
      headers: loadedHeaders.value,
      labels: mergedLabels.value,
      labelOverrides: options.labelOverrides.value,
      readStateOverrides: options.readStateOverrides.value,
      totalUnreadCount: labelsQuery.data.value?.totalUnreadCount ?? null,
    }),
  )
  const labels = computed(() => displayedCounts.value.labels)
  const displayedDetail = computed(() => {
    const detail = detailQuery.data.value
    if (!detail) return undefined
    const labelIds = options.labelOverrides.value.get(detail.mailId)
    return removeMailLabelIds(
      labelIds === undefined ? detail : { ...detail, labelIds: [...labelIds] },
      options.deletedLabelIds.value,
    )
  })
  const mailingLists = computed(() => listsQuery.data.value?.mailingLists ?? [])
  const filteredHeaders = computed(() =>
    filterDisplayedMailHeaders(
      displayedHeaders.value,
      {
        mailingListId: selectedMailingListId.value,
        search: search.value,
        unreadOnly: unreadOnly.value,
      },
      selectedMailId.value,
    ),
  )
  const selectedHeader = computed(() =>
    overlaidHeaders.value.find((header) => header.mailId === selectedMailId.value),
  )
  const selectedReadState = computed(() =>
    selectedHeader.value ? selectedHeader.value.isRead : (detailQuery.data.value?.isRead ?? null),
  )
  const initialErrors = computed(() => [
    headersQuery.error.value,
    labelsQuery.error.value,
    listsQuery.error.value,
  ])
  const mailboxStatus = computed(() =>
    deriveMailboxStatus({
      errors: initialErrors.value,
      hasInitialData: Boolean(
        headersQuery.data.value && labelsQuery.data.value && listsQuery.data.value,
      ),
      loading: [headersQuery, labelsQuery, listsQuery].some(
        (query) => query.asyncStatus.value === 'loading',
      ),
    }),
  )
  const mailboxError = computed(() =>
    initialErrors.value.find((error): error is ApiQueryError => error instanceof ApiQueryError),
  )
  const mailboxMessage = computed(
    () =>
      mailboxError.value?.message ||
      initialErrors.value.find((error): error is Error => error instanceof Error)?.message ||
      'Mail is temporarily unavailable.',
  )
  const authorizeUrl = computed(
    () =>
      initialErrors.value.find(
        (error): error is ApiQueryError =>
          error instanceof ApiQueryError && Boolean(error.authorizeUrl),
      )?.authorizeUrl,
  )
  const retryAfterSeconds = computed(
    () =>
      initialErrors.value.find(
        (error): error is ApiQueryError =>
          error instanceof ApiQueryError && error.retryAfterSeconds !== undefined,
      )?.retryAfterSeconds,
  )
  const detailError = computed(() =>
    detailQuery.error.value instanceof ApiQueryError ? detailQuery.error.value : undefined,
  )
  const cursorError = computed(() =>
    cursorQuery.error.value instanceof Error ? cursorQuery.error.value.message : '',
  )
  const showMailboxSkeleton = computed(
    () =>
      mailboxStatus.value === 'loading' ||
      (headersQuery.asyncStatus.value === 'loading' && loadedHeaders.value.length === 0),
  )
  const mailboxEmpty = computed(
    () =>
      !showMailboxSkeleton.value &&
      Boolean(headersQuery.data.value) &&
      activeLabelId.value === null &&
      loadedHeaders.value.length === 0,
  )
  const selectedLabelEmpty = computed(
    () => activeLabelId.value !== null && displayedHeaders.value.length === 0,
  )
  const localFiltersActive = computed(
    () => Boolean(search.value.trim()) || unreadOnly.value || selectedMailingListId.value !== null,
  )
  const headerEmptyMessage = computed(() => {
    if (selectedLabelEmpty.value) return 'There are no messages in this folder.'
    if (localFiltersActive.value)
      return 'No matches in loaded messages. Load older messages to search further.'
    return 'No messages are loaded.'
  })

  function resetMailboxView() {
    loadedHeaders.value = []
    nextLastMailId.value = null
    requestedCursor.value = null
    hasPaginated.value = false
    selectedMailId.value = null
  }

  function selectLabel(labelId: number | null) {
    if (activeLabelId.value === labelId) return
    resetMailboxView()
    activeLabelId.value = labelId
  }

  function selectMail(mailId: number) {
    selectedMailId.value = mailId
  }

  function loadOlder() {
    if (nextLastMailId.value === null) return
    if (requestedCursor.value === nextLastMailId.value) {
      void cursorQuery.refetch()
      return
    }
    requestedCursor.value = nextLastMailId.value
  }

  function retryMailbox() {
    void Promise.all([headersQuery.refetch(), labelsQuery.refetch(), listsQuery.refetch()])
  }

  function removeLoadedHeader(mailId: number) {
    loadedHeaders.value = loadedHeaders.value.filter((header) => header.mailId !== mailId)
  }

  function removeLoadedLabel(labelId: number) {
    const deletedLabelIds = new Set([labelId])
    loadedHeaders.value = loadedHeaders.value.map((header) =>
      removeMailLabelIds(header, deletedLabelIds),
    )
  }

  watch(options.characterId, resetMailboxView, { flush: 'sync' })

  watch(
    () => headersQuery.data.value,
    (page) => {
      if (!page) return
      loadedHeaders.value = hasPaginated.value
        ? mergePaginatedMailHeaders(loadedHeaders.value, page.messages)
        : replaceLatestMailHeaders(page.messages)
      options.reconcileReadState(page.messages)
      options.reconcileLabelState(page.messages)
      if (!hasPaginated.value) nextLastMailId.value = page.nextLastMailId
    },
    { immediate: true },
  )

  watch(
    () => cursorQuery.data.value,
    (page) => {
      if (!page || requestedCursor.value === null) return
      loadedHeaders.value = appendUniqueMailHeaders(loadedHeaders.value, page.messages)
      options.reconcileReadState(page.messages)
      options.reconcileLabelState(page.messages)
      hasPaginated.value = true
      nextLastMailId.value = page.nextLastMailId
      requestedCursor.value = null
    },
  )

  watch(
    () => detailQuery.data.value,
    (detail) => {
      if (detail) options.reconcileLabelState([detail])
    },
  )

  watch(
    () => labelsQuery.data.value,
    (retrieved) => {
      if (retrieved) options.reconcileCreatedLabels(retrieved.labels)
    },
    { immediate: true },
  )

  return {
    activeLabelId,
    authorizeUrl,
    cursorError,
    cursorQuery,
    detailError,
    detailQuery,
    displayedDetail,
    displayedCounts,
    displayedHeaders,
    filteredHeaders,
    headerEmptyMessage,
    labels,
    loadOlder,
    localFiltersActive,
    mailboxEmpty,
    mailboxMessage,
    mailboxStatus,
    mailingLists,
    nextLastMailId,
    removeLoadedHeader,
    removeLoadedLabel,
    resetMailboxView,
    retryAfterSeconds,
    retryMailbox,
    search,
    selectedHeader,
    selectedMailId,
    selectedMailingListId,
    selectedReadState,
    selectLabel,
    selectMail,
    showMailboxSkeleton,
    unreadOnly,
  }
}
