<script setup lang="ts">
import type { MailDetail, MailLabel } from '../../queries/mail'
import { isMailUnread, mailPartyName } from '../../utils/mail-view'

const props = defineProps<{
  detail?: MailDetail
  errorCode?: string
  errorMessage?: string
  labels: readonly MailLabel[]
  loading: boolean
  selected: boolean
}>()

defineEmits<{ retry: [] }>()

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
</script>

<template>
  <article class="mail-pane mail-reader" aria-labelledby="mail-reader-title">
    <UiScrollArea class="mail-pane-scroll mail-reader-scroll">
      <div v-if="!selected" class="mail-reader-state">
        <span>NO MESSAGE SELECTED</span>
        <h2 id="mail-reader-title">Select a message to read it</h2>
        <p>Choose a message from the list.</p>
      </div>
      <div v-else-if="loading && !detail" class="mail-reader-state" aria-live="polite">
        <span>LOADING MESSAGE</span>
        <h2 id="mail-reader-title">Opening message...</h2>
      </div>
      <div v-else-if="errorCode === 'MAIL_NOT_FOUND'" class="mail-reader-state" role="alert">
        <span>MAIL NOT FOUND</span>
        <h2 id="mail-reader-title">This message is no longer available</h2>
        <p>The mailbox remains available. Select another header to continue.</p>
      </div>
      <div v-else-if="errorMessage" class="mail-reader-state" role="alert">
        <span>MESSAGE UNAVAILABLE</span>
        <h2 id="mail-reader-title">Contents could not be retrieved</h2>
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
          <div
            class="mail-reader-actions"
            aria-label="Message actions unavailable in read-only mail"
          >
            <button type="button" disabled>REPLY</button>
            <button type="button" disabled>FORWARD</button>
            <button type="button" disabled>DELETE</button>
          </div>
        </header>
        <section class="mail-reader-content">
          <p class="mail-reader-date">
            <time v-if="detail.sentAt" :datetime="detail.sentAt">{{ formattedDate }} UTC</time>
            <span v-else>{{ formattedDate }}</span>
          </p>
          <h2 id="mail-reader-title">{{ detail.subject?.trim() || '(No subject)' }}</h2>
          <div v-if="labelChips.length > 0" class="mail-label-chips">
            <span v-for="label in labelChips" :key="label.labelId">{{ label.name }}</span>
          </div>
          <MailBodyText :body="detail.body" />
        </section>
        <footer class="mail-reader-footer">
          <span>MAIL ID {{ detail.mailId }}</span>
          <span>{{ isMailUnread(detail.isRead) ? 'UNREAD' : 'READ' }}</span>
        </footer>
      </template>
    </UiScrollArea>
  </article>
</template>
