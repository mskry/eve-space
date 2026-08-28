<script setup lang="ts">
import type { MailHeader, MailLabel } from '../../queries/mail'

defineProps<{
  canLoadOlder: boolean
  emptyMessage: string
  filtersActive: boolean
  filteredHeaders: readonly MailHeader[]
  labels: readonly MailLabel[]
  loadedCount: number
  loadingOlder: boolean
  olderError: string
  search: string
  selectedMailId: number | null
  unreadOnly: boolean
}>()

defineEmits<{
  loadOlder: []
  select: [mailId: number]
  'update:search': [search: string]
  'update:unreadOnly': [unreadOnly: boolean]
}>()

const currentTime = ref(Date.now())
let clock: ReturnType<typeof globalThis.setInterval> | undefined

onMounted(() => {
  currentTime.value = Date.now()
  clock = globalThis.setInterval(() => {
    currentTime.value = Date.now()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (clock) globalThis.clearInterval(clock)
})
</script>

<template>
  <section class="mail-pane mail-header-list" aria-labelledby="mail-headers-title">
    <header class="mail-pane-heading">
      <h2 id="mail-headers-title">Messages</h2>
    </header>
    <div class="mail-filter-controls">
      <input
        :value="search"
        type="search"
        autocomplete="off"
        placeholder="Search messages"
        aria-label="Search loaded messages by subject or sender"
        @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
      />
      <label class="mail-unread-toggle">
        <input
          :checked="unreadOnly"
          type="checkbox"
          @change="$emit('update:unreadOnly', ($event.target as HTMLInputElement).checked)"
        />
        <span aria-hidden="true" />
        UNREAD ONLY
      </label>
      <p aria-live="polite">
        <template v-if="filtersActive">
          {{ filteredHeaders.length }} of {{ loadedCount }} shown · Loaded messages only
        </template>
        <template v-else>{{ loadedCount }} messages loaded</template>
      </p>
    </div>
    <UiScrollArea class="mail-pane-scroll mail-header-scroll">
      <p v-if="filteredHeaders.length === 0" class="mail-pane-empty">{{ emptyMessage }}</p>
      <div v-else class="mail-header-rows">
        <MailHeaderRow
          v-for="header in filteredHeaders"
          :key="header.mailId"
          :header="header"
          :labels="labels"
          :now="currentTime"
          :selected="selectedMailId === header.mailId"
          @select="$emit('select', $event)"
        />
      </div>
    </UiScrollArea>
    <footer class="mail-list-footer">
      <span v-if="olderError" role="alert">{{ olderError }}</span>
      <button
        class="ui-action-secondary"
        type="button"
        :disabled="!canLoadOlder || loadingOlder"
        @click="$emit('loadOlder')"
      >
        {{
          loadingOlder
            ? 'LOADING OLDER MESSAGES...'
            : canLoadOlder
              ? 'LOAD OLDER MESSAGES'
              : 'ALL AVAILABLE MESSAGES LOADED'
        }}
      </button>
    </footer>
  </section>
</template>
