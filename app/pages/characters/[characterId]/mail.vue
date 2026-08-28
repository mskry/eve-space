<script setup lang="ts">
definePageMeta({ title: 'Character Mail', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const characterId = computed(() => {
  const value = Array.isArray(route.params.characterId)
    ? route.params.characterId[0]
    : route.params.characterId
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
})
const authenticated = computed(() => authSession.value.authenticated)
const mutations = useMailOrganizationMutations(apiClient)
const mailbox = useCharacterMailbox({
  apiClient,
  authenticated,
  characterId,
  deletedMailIds: mutations.deletedMailIds,
  deletePendingIds: mutations.deletePendingIds,
  readStateOverrides: mutations.readStateOverrides,
  reconcileReadState: mutations.reconcileReadState,
})
const organization = useMailOrganization({ characterId, mailbox, mutations })
const {
  activeLabelId,
  authorizeUrl,
  cursorError,
  cursorQuery,
  detailError,
  detailQuery,
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
  retryAfterSeconds,
  retryMailbox,
  search,
  selectedMailId,
  selectedMailingListId,
  selectedReadState,
  selectLabel,
  selectMail,
  showMailboxSkeleton,
  unreadOnly,
} = mailbox
const { changeOpenMessageRead, mutationPending, requestMailDeletion } = organization

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
    <CharacterAuthorizationRequired
      v-if="mailboxStatus === 'scope-required'"
      title="Mail authorization required"
      :message="mailboxMessage"
      :authorize-url="authorizeUrl"
    />
    <UiStatePanel
      v-else-if="mailboxStatus === 'cooldown'"
      code="ESI / COOLDOWN"
      title="Mail uplink rate limited"
      compact
      role="alert"
      tone="error"
    >
      <p>
        {{ mailboxMessage }}
        <template v-if="retryAfterSeconds !== undefined">
          Wait {{ retryAfterSeconds }} seconds before trying again.
        </template>
      </p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="mailboxStatus === 'error'"
      code="ERR / MAIL"
      title="Mail temporarily unavailable"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ mailboxMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="retryMailbox">TRY AGAIN</button>
      </template>
    </UiStatePanel>
    <UiStatePanel v-else-if="mailboxEmpty" code="NO MAIL" title="Mailbox empty" compact>
      <p>No messages were returned for this character.</p>
    </UiStatePanel>
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
        :mutation-pending="mutationPending"
        :read-state="selectedReadState"
        :selected="showMailboxSkeleton || selectedMailId !== null"
        @change-read="changeOpenMessageRead"
        @delete="requestMailDeletion"
        @retry="detailQuery.refetch()"
      />
    </div>
  </section>
</template>

<style>
@import url('~/assets/css/features/mail.css');
</style>
