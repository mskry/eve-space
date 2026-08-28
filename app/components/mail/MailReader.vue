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
  readState: MailHeader['isRead']
  selected: boolean
}>()

const emit = defineEmits<{
  changeRead: [read: boolean]
  delete: []
  retry: []
}>()

const senderName = computed(() => mailPartyName(props.detail?.sender ?? null, 'sender'))
const labelChips = computed(() => {
  const byId = new Map(
    props.labels.flatMap((label) =>
      label.labelId === null ? [] : [[label.labelId, label] as const],
    ),
  )
  return (props.detail?.labelIds ?? []).map((labelId) => ({
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
        <p id="mail-reader-loading-title" class="sr-only" role="status">Opening message...</p>
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
              <span v-for="index in 4" :key="index" class="mail-skeleton-block" />
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
              <p>
                TO
                <template v-if="detail.recipients.length > 0">
                  {{
                    detail.recipients.map((party) => mailPartyName(party, 'recipient')).join(', ')
                  }}
                </template>
                <template v-else>Unknown recipients</template>
              </p>
            </div>
          </div>
          <div class="mail-reader-actions" aria-label="Message actions">
            <button type="button" disabled>REPLY</button>
            <button type="button" disabled>FORWARD</button>
            <button
              type="button"
              :disabled="mutationPending"
              @click="emit('changeRead', isMailUnread(readState))"
            >
              {{ isMailUnread(readState) ? 'MARK READ' : 'MARK UNREAD' }}
            </button>
            <button
              class="mail-reader-action--danger"
              type="button"
              :disabled="mutationPending"
              @click="emit('delete')"
            >
              DELETE
            </button>
          </div>
        </header>
        <section class="mail-reader-content">
          <p class="mail-reader-date">
            <time v-if="detail.sentAt" :datetime="detail.sentAt">{{ formattedDate }} UTC</time>
            <span v-else>{{ formattedDate }}</span>
          </p>
          <h2 id="mail-reader-message-title">{{ detail.subject?.trim() || '(No subject)' }}</h2>
          <div v-if="labelChips.length > 0" class="mail-label-chips">
            <span v-for="label in labelChips" :key="label.labelId">{{ label.name }}</span>
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
