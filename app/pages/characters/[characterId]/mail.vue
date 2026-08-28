<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import {
  mailDetailQuery,
  mailHeadersQuery,
  mailingListsQuery,
  mailLabelsQuery,
  type MailHeader,
} from '../../../queries/mail'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import {
  applyMailOverlays,
  appendUniqueMailHeaders,
  deriveDisplayedMailCounts,
  deriveMailboxStatus,
  filterDisplayedMailHeaders,
  isMailUnread,
  mergeLatestMailHeaders,
  scheduleMailReadDwell,
} from '../../../utils/mail-view'
import { ApiQueryError } from '../../../utils/query-error'

definePageMeta({ title: 'Character Mail', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const {
  deleteMail,
  deletedMailIds,
  deletePendingIds,
  readPendingIds,
  readStateOverrides,
  reconcileReadState,
  resetMailMutations,
  setMailRead,
} = useMailMutations(apiClient)

const selectedMailId = ref<number | null>(null)
const activeLabelId = ref<number | null>(null)
const search = ref('')
const unreadOnly = ref(false)
const selectedMailingListId = ref<number | null>(null)
const loadedHeaders = ref<MailHeader[]>([])
const nextLastMailId = ref<number | null>(null)
const requestedCursor = ref<number | null>(null)
const hasPaginated = ref(false)
const autoReadSuppressedMailId = ref<number | null>(null)
const deleteCandidate = ref<MailHeader>()
const deleteDialogOpen = ref(false)
const toastOpen = ref(false)
const toastKey = ref(0)
const toastTitle = ref('')
const toastDescription = ref('')
const toastActionHref = ref('')
const toastDuration = ref(5000)
let cancelReadDwell: (() => void) | undefined

const characterId = computed(() => {
  const value = Array.isArray(route.params.characterId)
    ? route.params.characterId[0]
    : route.params.characterId
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
})
const selectedLabels = computed(() => (activeLabelId.value === null ? [] : [activeLabelId.value]))

const headersQuery = useQuery(() => ({
  ...mailHeadersQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    labels: selectedLabels.value,
  }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const labelsQuery = useQuery(() => ({
  ...mailLabelsQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const listsQuery = useQuery(() => ({
  ...mailingListsQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const cursorQuery = useQuery(() => ({
  ...mailHeadersQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    labels: selectedLabels.value,
    lastMailId: requestedCursor.value,
  }),
  enabled:
    requestedCursor.value !== null &&
    nextLastMailId.value === requestedCursor.value &&
    canRunProtectedQuery(import.meta.client, authSession.value.authenticated, characterId.value),
}))
const detailQuery = useQuery(() => ({
  ...mailDetailQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    mailId: selectedMailId.value ?? 0,
  }),
  enabled:
    selectedMailId.value !== null &&
    canRunProtectedQuery(import.meta.client, authSession.value.authenticated, characterId.value),
}))

const displayedHeaders = computed(() =>
  applyMailOverlays(loadedHeaders.value, readStateOverrides.value, deletedMailIds.value),
)
const displayedCounts = computed(() =>
  deriveDisplayedMailCounts({
    deletedMailIds: deletePendingIds.value,
    headers: loadedHeaders.value,
    labels: labelsQuery.data.value?.labels ?? [],
    readStateOverrides: readStateOverrides.value,
    totalUnreadCount: labelsQuery.data.value?.totalUnreadCount ?? null,
  }),
)
const labels = computed(() => displayedCounts.value.labels)
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
  displayedHeaders.value.find((header) => header.mailId === selectedMailId.value),
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
const mailboxEmpty = computed(
  () =>
    !showMailboxSkeleton.value &&
    Boolean(headersQuery.data.value) &&
    activeLabelId.value === null &&
    loadedHeaders.value.length === 0,
)
const showMailboxSkeleton = computed(
  () =>
    mailboxStatus.value === 'loading' ||
    (headersQuery.asyncStatus.value === 'loading' && loadedHeaders.value.length === 0),
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

function selectLabel(labelId: number | null) {
  if (activeLabelId.value === labelId) return
  resetMailboxView()
  activeLabelId.value = labelId
}

function resetMailboxView() {
  cancelReadDwell?.()
  cancelReadDwell = undefined
  deleteDialogOpen.value = false
  deleteCandidate.value = undefined
  loadedHeaders.value = []
  nextLastMailId.value = null
  requestedCursor.value = null
  hasPaginated.value = false
  selectedMailId.value = null
  autoReadSuppressedMailId.value = null
}

function resetCharacterMailbox() {
  resetMailboxView()
  resetMailMutations()
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

function showToast(options: { actionHref?: string; description: string; title: string }) {
  toastTitle.value = options.title
  toastDescription.value = options.description
  toastActionHref.value = options.actionHref ?? ''
  toastDuration.value = options.actionHref ? Number.POSITIVE_INFINITY : 5000
  toastKey.value += 1
  toastOpen.value = true
}

function showMutationFailure(action: 'delete' | 'read', error: unknown) {
  const fallback =
    action === 'delete' ? 'The message was not deleted.' : 'The read change was reverted.'
  if (
    error instanceof ApiQueryError &&
    (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
  ) {
    showToast({
      actionHref: error.authorizeUrl,
      description: error.message,
      title: 'Mail organization authorization required',
    })
    return
  }
  if (error instanceof ApiQueryError && error.code === 'MAIL_MUTATION_REJECTED') {
    showToast({
      description: `${fallback} EVE refused the change.`,
      title: 'Mail change refused',
    })
    return
  }
  showToast({
    description: error instanceof Error ? `${fallback} ${error.message}` : fallback,
    title: action === 'delete' ? 'Deletion reverted' : 'Read change reverted',
  })
}

async function changeMailRead(header: MailHeader, read: boolean, showSuccess = true) {
  if (!characterId.value || (header.isRead === true) === read) return
  const outcome = await setMailRead({ characterId: characterId.value, header, read })
  if (outcome.success && showSuccess) {
    showToast({
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
  if (!selectedHeader.value) return
  if (!read) {
    autoReadSuppressedMailId.value = selectedHeader.value.mailId
    cancelReadDwell?.()
    cancelReadDwell = undefined
  }
  void changeMailRead(selectedHeader.value, read)
}

function requestMailDeletion() {
  if (!selectedHeader.value) return
  deleteCandidate.value = selectedHeader.value
  globalThis.setTimeout(() => {
    deleteDialogOpen.value = true
  })
}

async function confirmMailDeletion() {
  const candidate = deleteCandidate.value
  if (
    !candidate ||
    !characterId.value ||
    readPendingIds.value.has(candidate.mailId) ||
    deletePendingIds.value.has(candidate.mailId)
  )
    return
  const mutationCharacterId = characterId.value
  const previousSelection = selectedMailId.value
  const request = deleteMail({ characterId: mutationCharacterId, header: candidate })
  selectedMailId.value = null
  const outcome = await request
  if (
    characterId.value !== mutationCharacterId ||
    deleteCandidate.value?.mailId !== candidate.mailId
  )
    return
  if (outcome.success) {
    loadedHeaders.value = loadedHeaders.value.filter((header) => header.mailId !== candidate.mailId)
    deleteDialogOpen.value = false
    showToast({
      description: 'The message was permanently removed. There is no archive or trash.',
      title: 'Message deleted',
    })
    return
  }

  if (displayedHeaders.value.some((header) => header.mailId === previousSelection)) {
    selectedMailId.value = previousSelection
  }
  deleteDialogOpen.value = false
  showMutationFailure(
    'delete',
    outcome.error ?? new Error('Another mail action is still in progress.'),
  )
}

watch(characterId, resetCharacterMailbox, { flush: 'sync' })

watch(
  [selectedMailId, () => detailQuery.data.value, () => detailQuery.error.value],
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
      const header = selectedHeader.value
      if (header?.mailId === mailId && isMailUnread(header.isRead)) {
        void changeMailRead(header, true, false)
      }
    })
    onCleanup(() => cancelReadDwell?.())
  },
  { flush: 'sync' },
)

watch(
  () => headersQuery.data.value,
  (page) => {
    if (!page) return
    loadedHeaders.value = mergeLatestMailHeaders(
      loadedHeaders.value,
      page.messages,
      hasPaginated.value,
    )
    reconcileReadState(page.messages)
    if (!hasPaginated.value) nextLastMailId.value = page.nextLastMailId
  },
  { immediate: true },
)

watch(
  () => cursorQuery.data.value,
  (page) => {
    if (!page || requestedCursor.value === null) return
    loadedHeaders.value = appendUniqueMailHeaders(loadedHeaders.value, page.messages)
    reconcileReadState(page.messages)
    hasPaginated.value = true
    nextLastMailId.value = page.nextLastMailId
    requestedCursor.value = null
  },
)

watch(
  [characterId, () => route.query.reauthorize],
  ([id, reauthorize]) => {
    if (id && reauthorize === 'success') retryMailbox()
  },
  { immediate: true },
)

onBeforeUnmount(() => cancelReadDwell?.())
</script>

<template>
  <section class="character-mail-route">
    <div v-if="mailboxStatus === 'scope-required'" class="mail-access-state" role="status">
      <span class="private-badge">SCOPE REQUIRED</span>
      <div>
        <h2>Mail authorization required</h2>
        <p>{{ mailboxMessage }}</p>
      </div>
      <a v-if="authorizeUrl" class="ui-action-primary" :href="authorizeUrl">
        AUTHORIZE THIS CHARACTER
      </a>
    </div>
    <div
      v-else-if="mailboxStatus === 'cooldown'"
      class="app-state-panel app-error-panel app-state-panel--compact"
      role="alert"
    >
      <span class="app-error-code">ESI / COOLDOWN</span>
      <h2>Mail uplink rate limited</h2>
      <p>
        {{ mailboxMessage }}
        <template v-if="retryAfterSeconds !== undefined">
          Wait {{ retryAfterSeconds }} seconds before trying again.
        </template>
      </p>
    </div>
    <div
      v-else-if="mailboxStatus === 'error'"
      class="app-state-panel app-error-panel app-state-panel--compact"
      role="alert"
    >
      <span class="app-error-code">ERR / MAIL</span>
      <h2>Mail temporarily unavailable</h2>
      <p>{{ mailboxMessage }}</p>
      <button class="ui-action-secondary" type="button" @click="retryMailbox">TRY AGAIN</button>
    </div>
    <div v-else-if="mailboxEmpty" class="app-state-panel app-state-panel--compact">
      <span class="app-error-code">NO MAIL</span>
      <h2>Mailbox empty</h2>
      <p>No messages were returned for this character.</p>
    </div>
    <div v-else class="mail-workspace" :aria-busy="showMailboxSkeleton">
      <MailLabelSidebar
        :active-label-id="activeLabelId"
        :labels="labels"
        :mailing-lists="mailingLists"
        :selected-mailing-list-id="selectedMailingListId"
        :total-unread-count="displayedCounts.totalUnreadCount"
        @select-label="selectLabel"
        @select-mailing-list="selectedMailingListId = $event"
      />
      <MailHeaderList
        v-model:search="search"
        v-model:unread-only="unreadOnly"
        :can-load-older="nextLastMailId !== null"
        :empty-message="headerEmptyMessage"
        :filters-active="localFiltersActive"
        :filtered-headers="filteredHeaders"
        :labels="labels"
        :loaded-count="displayedHeaders.length"
        :loading="showMailboxSkeleton"
        :loading-older="cursorQuery.asyncStatus.value === 'loading'"
        :older-error="cursorError"
        :selected-mail-id="selectedMailId"
        @load-older="loadOlder"
        @select="selectMail"
      />
      <MailReader
        :detail="detailQuery.data.value"
        :error-code="detailError?.code"
        :error-message="
          detailQuery.error.value instanceof Error ? detailQuery.error.value.message : ''
        "
        :labels="labels"
        :loading="showMailboxSkeleton || detailQuery.asyncStatus.value === 'loading'"
        :mutation-pending="
          selectedMailId !== null &&
          (readPendingIds.has(selectedMailId) || deletePendingIds.has(selectedMailId))
        "
        :read-state="selectedReadState"
        :selected="showMailboxSkeleton || selectedMailId !== null"
        @change-read="changeOpenMessageRead"
        @delete="requestMailDeletion"
        @retry="detailQuery.refetch()"
      />
    </div>
    <UiConfirmDialog
      v-model:open="deleteDialogOpen"
      :title="`Delete ${deleteCandidate?.subject?.trim() || `mail ${deleteCandidate?.mailId ?? ''}`}?`"
      description="This permanently deletes the message. EVE provides no archive or trash, and this action cannot be undone."
      confirm-label="Delete message"
      :pending-label="
        deleteCandidate && readPendingIds.has(deleteCandidate.mailId)
          ? 'Waiting for mail update...'
          : 'Deleting...'
      "
      :pending="
        deleteCandidate
          ? readPendingIds.has(deleteCandidate.mailId) ||
            deletePendingIds.has(deleteCandidate.mailId)
          : false
      "
      tone="danger"
      @confirm="confirmMailDeletion"
    />
    <UiToast
      :key="toastKey"
      v-model:open="toastOpen"
      :title="toastTitle"
      :description="toastDescription"
      :duration="toastDuration"
      :action-href="toastActionHref || undefined"
      action-label="Authorize character"
    />
  </section>
</template>

<style>
@import url('~/assets/css/features/mail.css');
</style>
