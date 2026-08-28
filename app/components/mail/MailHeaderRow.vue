<script setup lang="ts">
import type { MailHeader, MailLabel } from '../../queries/mail'
import { formatRelativeTime } from '../../utils/format'
import { isMailUnread, mailPartyName } from '../../utils/mail-view'

const props = defineProps<{
  header: MailHeader
  labels: readonly MailLabel[]
  now: number
  selected: boolean
}>()

defineEmits<{ select: [mailId: number] }>()

const senderName = computed(() => mailPartyName(props.header.sender, 'sender'))
const senderInitial = computed(() => senderName.value.charAt(0).toLocaleUpperCase() || '?')
const visibleLabels = computed(() => {
  const byId = new Map(
    props.labels.flatMap((label) =>
      label.labelId === null ? [] : [[label.labelId, label] as const],
    ),
  )
  return props.header.labelIds.map((labelId) => ({
    labelId,
    name: byId.get(labelId)?.name?.trim() || `Label #${labelId}`,
  }))
})
const relativeTime = computed(() => formatRelativeTime(props.header.sentAt, props.now))
</script>

<template>
  <button
    class="mail-header-row"
    :class="{ 'is-selected': selected, 'is-unread': isMailUnread(header.isRead) }"
    type="button"
    @click="$emit('select', header.mailId)"
  >
    <UiEveImage
      v-if="header.sender?.type === 'character'"
      kind="character"
      :id="header.sender.id"
      :dimension="44"
      :alt="`${senderName} portrait`"
    />
    <span v-else class="mail-party-fallback" aria-hidden="true">{{ senderInitial }}</span>
    <span class="mail-header-copy">
      <span class="mail-header-meta">
        <strong>{{ senderName }}</strong>
        <time v-if="header.sentAt" :datetime="header.sentAt">{{ relativeTime }}</time>
        <span v-else>{{ relativeTime }}</span>
      </span>
      <span class="mail-header-subject">
        <i v-if="isMailUnread(header.isRead)" aria-label="Unread message" />
        {{ header.subject?.trim() || '(No subject)' }}
      </span>
      <span v-if="visibleLabels.length > 0" class="mail-label-chips">
        <span v-for="label in visibleLabels" :key="label.labelId">{{ label.name }}</span>
      </span>
    </span>
  </button>
</template>
