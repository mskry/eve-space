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
  appendUniqueMailHeaders,
  deriveMailboxStatus,
  filterLoadedMailHeaders,
  mergeLatestMailHeaders,
} from '../../../utils/mail-view'
import { ApiQueryError } from '../../../utils/query-error'

definePageMeta({ title: 'Character Mail', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)

const selectedMailId = ref<number | null>(null)
const activeLabelId = ref<number | null>(null)
const search = ref('')
const unreadOnly = ref(false)
const selectedMailingListId = ref<number | null>(null)
const loadedHeaders = ref<MailHeader[]>([])
const nextLastMailId = ref<number | null>(null)
const requestedCursor = ref<number | null>(null)
const hasPaginated = ref(false)

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

const labels = computed(() => labelsQuery.data.value?.labels ?? [])
const mailingLists = computed(() => listsQuery.data.value?.mailingLists ?? [])
const filteredHeaders = computed(() =>
  filterLoadedMailHeaders(loadedHeaders.value, {
    mailingListId: selectedMailingListId.value,
    search: search.value,
    unreadOnly: unreadOnly.value,
  }),
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
    Boolean(headersQuery.data.value) &&
    activeLabelId.value === null &&
    loadedHeaders.value.length === 0,
)
const selectedLabelEmpty = computed(
  () => activeLabelId.value !== null && loadedHeaders.value.length === 0,
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
  loadedHeaders.value = []
  nextLastMailId.value = null
  requestedCursor.value = null
  hasPaginated.value = false
  selectedMailId.value = null
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

watch(characterId, resetMailboxView, { flush: 'sync' })

watch(
  () => headersQuery.data.value,
  (page) => {
    if (!page) return
    loadedHeaders.value = mergeLatestMailHeaders(
      loadedHeaders.value,
      page.messages,
      hasPaginated.value,
    )
    if (!hasPaginated.value) nextLastMailId.value = page.nextLastMailId
  },
  { immediate: true },
)

watch(
  () => cursorQuery.data.value,
  (page) => {
    if (!page || requestedCursor.value === null) return
    loadedHeaders.value = appendUniqueMailHeaders(loadedHeaders.value, page.messages)
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
</script>

<template>
  <section class="character-mail-route">
    <div
      v-if="mailboxStatus === 'loading'"
      class="app-state-panel app-state-panel--compact"
      aria-live="polite"
    >
      <div class="app-scanner" aria-hidden="true" />
      <p>Loading mail...</p>
    </div>
    <div v-else-if="mailboxStatus === 'scope-required'" class="mail-access-state" role="status">
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
    <div v-else class="mail-workspace">
      <MailLabelSidebar
        :active-label-id="activeLabelId"
        :labels="labels"
        :mailing-lists="mailingLists"
        :selected-mailing-list-id="selectedMailingListId"
        :total-unread-count="labelsQuery.data.value?.totalUnreadCount ?? null"
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
        :loaded-count="loadedHeaders.length"
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
        :loading="detailQuery.asyncStatus.value === 'loading'"
        :selected="selectedMailId !== null"
        @retry="detailQuery.refetch()"
      />
    </div>
  </section>
</template>

<style>
@import url('~/assets/css/features/mail.css');
</style>
