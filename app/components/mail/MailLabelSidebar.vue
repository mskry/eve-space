<script setup lang="ts">
import type { MailLabel, MailingList } from '../../queries/mail'

defineProps<{
  activeLabelId: number | null
  labels: readonly MailLabel[]
  mailingLists: readonly MailingList[]
  selectedMailingListId: number | null
  totalUnreadCount: number | null
}>()

defineEmits<{
  compose: []
  manageLabels: []
  selectLabel: [labelId: number | null]
  selectMailingList: [mailingListId: number | null]
}>()

function labelName(label: MailLabel, index: number) {
  return label.name?.trim() || `Label ${index + 1}`
}
</script>

<template>
  <aside class="mail-pane mail-sidebar" aria-label="Mailbox navigation">
    <header class="mail-pane-heading">
      <h2>Folders</h2>
      <button class="mail-pane-heading-action" type="button" @click="$emit('manageLabels')">
        MANAGE
      </button>
    </header>
    <UiScrollArea class="mail-pane-scroll">
      <nav aria-label="Mail labels">
        <button
          class="mail-nav-row"
          :class="{ 'is-active': activeLabelId === null }"
          type="button"
          @click="$emit('selectLabel', null)"
        >
          <span>All mail</span>
          <strong v-if="totalUnreadCount !== null">{{ totalUnreadCount }}</strong>
        </button>
        <button
          v-for="(label, index) in labels"
          :key="label.labelId ?? `unknown-${index}`"
          class="mail-nav-row"
          :class="{ 'is-active': label.labelId !== null && activeLabelId === label.labelId }"
          type="button"
          :disabled="label.labelId === null"
          @click="label.labelId !== null && $emit('selectLabel', label.labelId)"
        >
          <span class="mail-label-name-with-swatch">
            <span
              v-if="label.color"
              class="mail-label-color"
              :style="{ backgroundColor: label.color }"
              aria-hidden="true"
            />
            <span>{{ labelName(label, index) }}</span>
          </span>
          <strong v-if="label.unreadCount !== null">{{ label.unreadCount }}</strong>
        </button>
      </nav>

      <section class="mail-list-nav" aria-labelledby="mailing-lists-title">
        <h3 id="mailing-lists-title">Mailing lists · loaded messages</h3>
        <button
          class="mail-nav-row"
          :class="{ 'is-active': selectedMailingListId === null }"
          type="button"
          @click="$emit('selectMailingList', null)"
        >
          <span>All recipients</span>
        </button>
        <button
          v-for="list in mailingLists"
          :key="list.mailingListId"
          class="mail-nav-row"
          :class="{ 'is-active': selectedMailingListId === list.mailingListId }"
          type="button"
          @click="$emit('selectMailingList', list.mailingListId)"
        >
          <span>{{ list.name }}</span>
        </button>
      </section>
    </UiScrollArea>
    <footer class="mail-sidebar-footer">
      <button class="ui-action-primary" type="button" @click="$emit('compose')">COMPOSE</button>
      <span>Start a new message as this character.</span>
    </footer>
  </aside>
</template>
