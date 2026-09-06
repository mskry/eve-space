<script setup lang="ts">
import type { EsiResourceState } from '../../../types/esi-resource'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ title: 'Character Mail', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const authenticated = computed(() => authSession.value.authenticated)
const ownsCharacter = computed(() =>
  characters.value.some((character) => character.characterId === characterId.value),
)
const mutations = useMailOrganizationMutations(apiClient)
const mailbox = useCharacterMailbox({
  apiClient,
  authenticated,
  characterId,
  ownsCharacter,
  createdLabels: mutations.createdLabels,
  deletedLabelIds: mutations.deletedLabelIds,
  deletedMailIds: mutations.deletedMailIds,
  deletePendingIds: mutations.deletePendingIds,
  labelOverrides: mutations.labelOverrides,
  readStateOverrides: mutations.readStateOverrides,
  reconcileCreatedLabels: mutations.reconcileCreatedLabels,
  reconcileLabelState: mutations.reconcileLabelState,
  reconcileReadState: mutations.reconcileReadState,
})
const organization = useMailOrganization({ characterId, mailbox, mutations })
const composition = useMailComposition({
  apiClient,
  authenticated,
  characterId,
  mailbox,
})
const {
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
const {
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
} = organization
const {
  addRecipient,
  body,
  bodyRemaining,
  canReply,
  chargeRecoveryAvailable,
  feedback,
  mode,
  omitted,
  open: composeOpen,
  openForward,
  openNew,
  openReply,
  openReplyAll,
  recipientInput,
  recipientSuggestions,
  recipients,
  recoverCharge,
  removeRecipient,
  replyUnavailableReason,
  requestClose: requestCompositionClose,
  resolveRecipient,
  resolving,
  searchAuthorization,
  searchFeedback,
  searching,
  send: sendComposition,
  sendDisabledReason,
  sendAuthorizationMessage,
  sendAuthorizationUrl,
  sending,
  subject,
  subjectRemaining,
} = composition

const mailboxResourceState = computed<EsiResourceState>(() => {
  if (mailboxStatus.value === 'loading') {
    return { status: 'loading', title: '', message: null }
  }
  if (mailboxStatus.value === 'scope-required') {
    return {
      status: 'authorization-required',
      code: 'ESI 403 / MAIL',
      title: 'Mail authorization required',
      message: mailboxMessage.value,
      action: authorizeUrl.value
        ? { href: authorizeUrl.value, label: 'AUTHORIZE THIS CHARACTER' }
        : null,
    }
  }
  if (mailboxStatus.value === 'cooldown') {
    return {
      status: 'error',
      code: 'ESI / COOLDOWN',
      title: 'Mail uplink rate limited',
      message: `${mailboxMessage.value}${
        retryAfterSeconds.value === undefined
          ? ''
          : ` Wait ${retryAfterSeconds.value} seconds before trying again.`
      }`,
    }
  }
  if (mailboxStatus.value === 'error') {
    return {
      status: 'error',
      code: 'ERR / MAIL',
      title: 'Mail temporarily unavailable',
      message: mailboxMessage.value,
      retryLabel: 'TRY AGAIN',
    }
  }
  return { status: 'ready' }
})

useCharacterReauthorization(characterId, retryMailbox)
</script>

<template>
  <section class="character-mail-route">
    <EsiResourceBoundary
      :state="mailboxResourceState"
      :has-data="mailboxStatus === 'idle' || mailboxStatus === 'loading'"
      @retry="retryMailbox"
    >
      <UiStatePanel v-if="mailboxEmpty" code="NO MAIL" title="Mailbox empty" compact>
        <p>No messages were returned for this character.</p>
        <template #action>
          <button class="ui-action-primary" type="button" @click="openNew">COMPOSE MAIL</button>
          <button class="ui-action-secondary" type="button" @click="openLabelManagement">
            MANAGE LABELS
          </button>
        </template>
      </UiStatePanel>
      <div v-else class="mail-workspace" :aria-busy="showMailboxSkeleton">
        <MailLabelSidebar
          :active-label-id="activeLabelId"
          :labels="labels"
          :mailing-lists="mailingLists"
          :selected-mailing-list-id="selectedMailingListId"
          :total-unread-count="displayedCounts.totalUnreadCount"
          @compose="openNew"
          @manage-labels="openLabelManagement"
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
          :detail="displayedDetail"
          :error-code="detailError?.code"
          :error-message="
            detailQuery.error.value instanceof Error ? detailQuery.error.value.message : ''
          "
          :labels="labels"
          :loading="showMailboxSkeleton || detailQuery.asyncStatus.value === 'loading'"
          :mutation-pending="mutationPending"
          :can-reply="canReply"
          :reply-unavailable-reason="replyUnavailableReason"
          :read-state="selectedReadState"
          :selected="showMailboxSkeleton || selectedMailId !== null"
          @change-read="changeOpenMessageRead"
          @delete="requestMailDeletion"
          @forward="openForward"
          @manage-labels="openLabelAssignment"
          @reply="openReply"
          @reply-all="openReplyAll"
          @retry="detailQuery.refetch()"
        />
      </div>
    </EsiResourceBoundary>
    <MailLabelManagementDialog
      v-model:color="labelColor"
      v-model:name="labelName"
      v-model:open="labelManagementOpen"
      :create-feedback="createLabelFeedback"
      :creating="mutations.createLabelPending.value"
      :delete-pending-ids="mutations.deleteLabelPendingIds.value"
      :labels="labels"
      :undeletable-label-ids="mutations.undeletableLabelIds.value"
      @create="createLabel"
      @delete="requestLabelDeletion"
    />
    <MailLabelAssignmentDialog
      v-model:open="labelAssignmentOpen"
      :assigned-label-ids="assignedLabelIds"
      :feedback="assignmentFeedback"
      :labels="labels"
      :pending="mutationPending || mutations.deleteLabelPendingIds.value.size > 0"
      @change="changeOpenMessageLabel"
    />
    <MailComposeDialog
      v-model:body="body"
      v-model:recipient-input="recipientInput"
      v-model:subject="subject"
      :body-remaining="bodyRemaining"
      :charge-recovery-available="chargeRecoveryAvailable"
      :feedback="feedback"
      :mode="mode"
      :omitted="omitted"
      :open="composeOpen"
      :recipients="recipients"
      :resolving="resolving"
      :search-authorization-message="searchAuthorization?.message"
      :search-authorization-url="searchAuthorization?.authorizeUrl"
      :search-feedback="searchFeedback"
      :searching="searching"
      :send-authorization-message="sendAuthorizationMessage"
      :send-authorization-url="sendAuthorizationUrl"
      :send-disabled-reason="sendDisabledReason"
      :sending="sending"
      :subject-remaining="subjectRemaining"
      :suggestions="recipientSuggestions"
      @add-recipient="addRecipient"
      @close="requestCompositionClose"
      @recover-charge="recoverCharge"
      @remove-recipient="removeRecipient"
      @resolve-recipient="resolveRecipient"
      @send="sendComposition"
    />
  </section>
</template>

<style>
@import url('~/assets/css/features/mail.css');
</style>
