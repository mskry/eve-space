<script setup lang="ts">
import type { MailDetail, MailHeader, MailLabel } from '../../queries/mail'
import { isMailUnread, mailPartyName } from '../../utils/mail-view'

const props = defineProps<{
  detail?: MailDetail
  errorCode?: string
  errorMessage?: string
  labels: readonly MailLabel[]
  loading: boolean
  mutationPending: boolean
  canReply: boolean
  replyUnavailableReason?: string
  readState: MailHeader['isRead']
  selected: boolean
}>()

const emit = defineEmits<{
  changeRead: [read: boolean]
  delete: []
  forward: []
  manageLabels: []
  reply: []
  replyAll: []
  retry: []
}>()

const senderName = computed(() => mailPartyName(props.detail?.sender ?? null, 'sender'))
const recipientsLabel = computed(() => {
  const names =
    props.detail?.recipients.map((party) => mailPartyName(party, 'recipient')).join(', ') ?? ''
  return `TO ${names || 'Unknown recipients'}`
})
const recipientsRevealed = ref(false)
const labelChips = computed(() => {
  const byId = new Map(
    props.labels.flatMap((label) =>
      label.labelId === null ? [] : [[label.labelId, label] as const],
    ),
  )
  return (props.detail?.labelIds ?? []).map((labelId) => ({
    color: byId.get(labelId)?.color,
    labelId,
    name: byId.get(labelId)?.name?.trim() || `Label #${labelId}`,
  }))
})
const formattedDate = computed(() => {
  if (!props.detail?.sentAt) return 'Time unknown'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(props.detail.sentAt))
})
const readerTitleId = computed(() => {
  if (!props.selected) return 'mail-reader-empty-title'
  if (props.loading && !props.detail) return 'mail-reader-loading-title'
  if (props.errorCode === 'MAIL_NOT_FOUND') return 'mail-reader-not-found-title'
  if (props.errorMessage) return 'mail-reader-error-title'
  if (props.detail) return 'mail-reader-message-title'
  return undefined
})

watch(recipientsLabel, () => {
  recipientsRevealed.value = false
})

function revealTruncatedRecipients(event: MouseEvent) {
  const recipients = event.currentTarget as HTMLElement
  recipientsRevealed.value = recipients.scrollWidth > recipients.clientWidth
}
</script>

<template>
  <article class="mail-pane mail-reader" :aria-labelledby="readerTitleId">
    <UiScrollArea class="mail-pane-scroll mail-reader-scroll">
      <div v-if="!selected" class="mail-reader-state">
        <span>NO MESSAGE SELECTED</span>
        <h2 id="mail-reader-empty-title">Select a message to read it</h2>
        <p>Choose a message from the list.</p>
      </div>
      <template v-else-if="loading && !detail">
        <output id="mail-reader-loading-title" class="sr-only">Opening message...</output>
        <div class="mail-reader-skeleton" aria-hidden="true">
          <header class="mail-reader-heading">
            <div class="mail-reader-identity">
              <span class="mail-skeleton-block mail-skeleton-reader-avatar" />
              <span class="mail-reader-skeleton-identity">
                <span class="mail-skeleton-block mail-skeleton-reader-kicker" />
                <span class="mail-skeleton-block mail-skeleton-reader-name" />
                <span class="mail-skeleton-block mail-skeleton-reader-recipient" />
              </span>
            </div>
            <div class="mail-reader-skeleton-actions">
              <span v-for="index in 6" :key="index" class="mail-skeleton-block" />
            </div>
          </header>
          <section class="mail-reader-content mail-reader-skeleton-content">
            <span class="mail-skeleton-block mail-skeleton-reader-date" />
            <span class="mail-skeleton-block mail-skeleton-reader-title" />
            <span class="mail-skeleton-block mail-skeleton-reader-chip" />
            <span class="mail-reader-skeleton-body">
              <span class="mail-skeleton-block" />
              <span class="mail-skeleton-block" />
              <span class="mail-skeleton-block" />
              <span class="mail-skeleton-block" />
              <span class="mail-skeleton-block" />
            </span>
          </section>
          <footer class="mail-reader-footer mail-reader-skeleton-footer">
            <span class="mail-skeleton-block" />
            <span class="mail-skeleton-block" />
          </footer>
        </div>
      </template>
      <div v-else-if="errorCode === 'MAIL_NOT_FOUND'" class="mail-reader-state" role="alert">
        <span>MAIL NOT FOUND</span>
        <h2 id="mail-reader-not-found-title">This message is no longer available</h2>
        <p>The mailbox remains available. Select another header to continue.</p>
      </div>
      <div v-else-if="errorMessage" class="mail-reader-state" role="alert">
        <span>MESSAGE UNAVAILABLE</span>
        <h2 id="mail-reader-error-title">Contents could not be retrieved</h2>
        <p>{{ errorMessage }}</p>
        <button class="ui-action-secondary" type="button" @click="$emit('retry')">
          RETRY MESSAGE
        </button>
      </div>
      <template v-else-if="detail">
        <header class="mail-reader-heading">
          <div class="mail-reader-identity">
            <UiEveImage
              v-if="detail.sender?.type === 'character'"
              kind="character"
              :id="detail.sender.id"
              :dimension="64"
              :alt="`${senderName} portrait`"
            />
            <span v-else class="mail-party-fallback mail-party-fallback--large" aria-hidden="true">
              {{ senderName.charAt(0).toLocaleUpperCase() || '?' }}
            </span>
            <div>
              <span>FROM</span>
              <strong>{{ senderName }}</strong>
              <p
                class="mail-reader-recipients"
                :class="{ 'is-revealed': recipientsRevealed }"
                :data-full-recipients="recipientsLabel"
                @mouseenter="revealTruncatedRecipients"
                @mouseleave="recipientsRevealed = false"
              >
                {{ recipientsLabel }}
              </p>
            </div>
          </div>
          <div class="mail-reader-actions" aria-label="Message actions">
            <UiTooltip content="REPLY">
              <button
                type="button"
                aria-label="REPLY"
                :disabled="!canReply"
                :title="replyUnavailableReason"
                @click="emit('reply')"
              >
                <MailReaderActionIcon name="reply" />
              </button>
            </UiTooltip>
            <UiTooltip content="REPLY ALL">
              <button type="button" aria-label="REPLY ALL" @click="emit('replyAll')">
                <MailReaderActionIcon name="reply-all" />
              </button>
            </UiTooltip>
            <UiTooltip content="FORWARD">
              <button type="button" aria-label="FORWARD" @click="emit('forward')">
                <MailReaderActionIcon name="forward" />
              </button>
            </UiTooltip>
            <UiTooltip content="LABELS">
              <button
                type="button"
                aria-label="LABELS"
                :disabled="mutationPending"
                @click="emit('manageLabels')"
              >
                <MailReaderActionIcon name="labels" />
              </button>
            </UiTooltip>
            <UiTooltip :content="isMailUnread(readState) ? 'MARK READ' : 'MARK UNREAD'">
              <button
                type="button"
                :aria-label="isMailUnread(readState) ? 'MARK READ' : 'MARK UNREAD'"
                :disabled="mutationPending"
                @click="emit('changeRead', isMailUnread(readState))"
              >
                <MailReaderActionIcon
                  :name="isMailUnread(readState) ? 'mark-read' : 'mark-unread'"
                />
              </button>
            </UiTooltip>
            <UiTooltip content="DELETE">
              <button
                class="mail-reader-action--danger"
                type="button"
                aria-label="DELETE"
                :disabled="mutationPending"
                @click="emit('delete')"
              >
                <MailReaderActionIcon name="delete" />
              </button>
            </UiTooltip>
          </div>
        </header>
        <section class="mail-reader-content">
          <p class="mail-reader-date">
            <time v-if="detail.sentAt" :datetime="detail.sentAt">{{ formattedDate }} UTC</time>
            <span v-else>{{ formattedDate }}</span>
          </p>
          <h2 id="mail-reader-message-title">{{ detail.subject?.trim() || '(No subject)' }}</h2>
          <div v-if="labelChips.length > 0" class="mail-label-chips">
            <span v-for="label in labelChips" :key="label.labelId">
              <span
                v-if="label.color"
                class="mail-label-color"
                :style="{ backgroundColor: label.color }"
                aria-hidden="true"
              />
              {{ label.name }}
            </span>
          </div>
          <MailBodyText :body="detail.body" />
        </section>
        <footer class="mail-reader-footer">
          <span>MAIL ID {{ detail.mailId }}</span>
          <span>{{ isMailUnread(readState) ? 'UNREAD' : 'READ' }}</span>
        </footer>
      </template>
    </UiScrollArea>
  </article>
</template>
