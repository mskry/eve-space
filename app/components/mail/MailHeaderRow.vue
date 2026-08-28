<script setup lang="ts">
import type { MailHeader, MailLabel } from '../../queries/mail'
import { isMailUnread, mailPartyName } from '../../utils/mail-view'

const props = defineProps<{
  header: MailHeader
  labels: readonly MailLabel[]
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
const relativeTime = computed(() => formatRelativeTime(props.header.sentAt))

function formatRelativeTime(value: string | null) {
  if (!value) return 'Time unknown'
  const difference = Date.parse(value) - Date.now()
  if (!Number.isFinite(difference)) return 'Time unknown'
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const absolute = Math.abs(difference)
  if (absolute < 60_000) return formatter.format(Math.round(difference / 1_000), 'second')
  if (absolute < 3_600_000) return formatter.format(Math.round(difference / 60_000), 'minute')
  if (absolute < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), 'hour')
  return formatter.format(Math.round(difference / 86_400_000), 'day')
}
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
