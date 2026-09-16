<script setup lang="ts">
import type { MailHeader } from '../../queries/mail'
import { isMailUnread } from '../../utils/mail-view'

const {
  canReply,
  loading = false,
  mutationPending,
  readState,
  replyUnavailableReason,
} = defineProps<{
  canReply: boolean
  loading?: boolean
  mutationPending: boolean
  readState: MailHeader['isRead']
  replyUnavailableReason?: string
}>()

const emit = defineEmits<{
  changeRead: [read: boolean]
  delete: []
  forward: []
  manageLabels: []
  reply: []
  replyAll: []
}>()

const unread = computed(() => isMailUnread(readState))
const readActionLabel = computed(() => (unread.value ? 'MARK READ' : 'MARK UNREAD'))
</script>

<template>
  <div class="mail-reader-actions" aria-label="Message actions" :inert="loading">
    <UiTooltip content="REPLY">
      <button
        type="button"
        aria-label="REPLY"
        :disabled="!loading && !canReply"
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
    <UiTooltip :content="readActionLabel">
      <button
        type="button"
        :aria-label="readActionLabel"
        :disabled="mutationPending"
        @click="emit('changeRead', unread)"
      >
        <MailReaderActionIcon :name="unread ? 'mark-read' : 'mark-unread'" />
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
</template>
