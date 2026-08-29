<script setup lang="ts">
import type { MailHeader, MailLabel } from '../../queries/mail'

withDefaults(
  defineProps<{
    canLoadOlder: boolean
    emptyMessage: string
    filtersActive: boolean
    filteredHeaders: readonly MailHeader[]
    labels: readonly MailLabel[]
    loadedCount: number
    loading?: boolean
    loadingOlder: boolean
    olderError: string
    search: string
    selectedMailId: number | null
    unreadOnly: boolean
  }>(),
  { loading: false },
)

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
  <section
    class="mail-pane mail-header-list"
    aria-labelledby="mail-headers-title"
    :aria-busy="loading"
  >
    <header class="mail-pane-heading">
      <h2 id="mail-headers-title">Messages</h2>
    </header>
    <output v-if="loading" class="sr-only">Loading messages...</output>
    <div v-if="loading" class="mail-filter-controls mail-skeleton-filter" aria-hidden="true">
      <span class="mail-skeleton-block mail-skeleton-search" />
      <span class="mail-skeleton-block mail-skeleton-toggle" />
      <span class="mail-skeleton-block mail-skeleton-count" />
    </div>
    <div v-else class="mail-filter-controls">
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
      <div v-if="loading" class="mail-header-skeletons" aria-hidden="true">
        <div v-for="index in 6" :key="index" class="mail-header-skeleton">
          <span class="mail-skeleton-block mail-skeleton-avatar" />
          <span class="mail-header-skeleton-copy">
            <span class="mail-header-skeleton-meta">
              <span class="mail-skeleton-block mail-skeleton-sender" />
              <span class="mail-skeleton-block mail-skeleton-time" />
            </span>
            <span class="mail-skeleton-block mail-skeleton-subject" />
            <span class="mail-skeleton-block mail-skeleton-label" />
          </span>
        </div>
      </div>
      <p v-else-if="filteredHeaders.length === 0" class="mail-pane-empty">
        {{ emptyMessage }}
      </p>
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
    <footer v-if="loading" class="mail-list-footer mail-list-footer--skeleton" aria-hidden="true">
      <span class="mail-skeleton-block" />
    </footer>
    <footer v-else class="mail-list-footer">
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
