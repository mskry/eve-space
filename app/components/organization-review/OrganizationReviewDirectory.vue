<script setup lang="ts">
import type { OrganizationReviewDirectoryMember } from '../../queries/organization-review'

const props = defineProps<{
  corporationText: string
  hasNextPage: boolean
  hasPreviousPage: boolean
  limit: number
  loading: boolean
  members: readonly OrganizationReviewDirectoryMember[]
  searchText: string
  selectedUserId?: string
}>()

const emit = defineEmits<{
  next: []
  previous: []
  search: []
  select: [member: OrganizationReviewDirectoryMember]
  'update:corporationText': [value: string]
  'update:limit': [value: number]
  'update:searchText': [value: string]
}>()

function mainCharacterName(member: OrganizationReviewDirectoryMember) {
  return member.account.mainCharacter?.name ?? `Account ${member.account.userId}`
}
</script>

<template>
  <section class="organization-review-directory" aria-labelledby="review-directory-heading">
    <header>
      <p class="ui-eyebrow">MANAGED DIRECTORY</p>
      <h2 id="review-directory-heading">Select a member</h2>
    </header>

    <form
      class="organization-review-directory__filters"
      role="search"
      @submit.prevent="emit('search')"
    >
      <label>
        <span>Member search</span>
        <input
          :value="props.searchText"
          type="search"
          maxlength="80"
          autocomplete="off"
          placeholder="Character or account"
          @input="emit('update:searchText', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>Corporation ID</span>
        <input
          :value="props.corporationText"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          placeholder="All managed corporations"
          @input="emit('update:corporationText', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>Results per page</span>
        <select
          :value="props.limit"
          @change="emit('update:limit', Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="10">10</option>
          <option :value="25">25</option>
          <option :value="50">50</option>
        </select>
      </label>
      <button class="ui-action-primary" type="submit" :disabled="props.loading">SEARCH</button>
    </form>

    <output v-if="props.loading" class="organization-review-directory__status">
      Searching managed members...
    </output>
    <output v-else-if="props.members.length === 0" class="organization-review-directory__status">
      No managed members match these filters.
    </output>
    <ul v-else class="organization-review-directory__results" aria-label="Managed members">
      <li v-for="member in props.members" :key="member.managedMemberLifecycleId">
        <button
          type="button"
          :aria-pressed="member.account.userId === props.selectedUserId"
          @click="emit('select', member)"
        >
          <strong>{{ mainCharacterName(member) }}</strong>
          <span>Corporation {{ member.managedAffiliation.corporationId }}</span>
          <span>Character {{ member.managedAffiliation.name }}</span>
        </button>
      </li>
    </ul>

    <nav class="organization-review-directory__pagination" aria-label="Member directory pages">
      <button
        class="ui-action-secondary"
        type="button"
        :disabled="!props.hasPreviousPage || props.loading"
        @click="emit('previous')"
      >
        PREVIOUS
      </button>
      <button
        class="ui-action-secondary"
        type="button"
        :disabled="!props.hasNextPage || props.loading"
        @click="emit('next')"
      >
        NEXT
      </button>
    </nav>
  </section>
</template>

<style scoped>
.organization-review-directory {
  min-width: 0;
  padding: clamp(1rem, 2vw, 1.5rem);
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-raised);
}

.organization-review-directory h2 {
  margin: 0.25rem 0 0;
}

.organization-review-directory__filters {
  display: grid;
  grid-template-columns: minmax(12rem, 2fr) minmax(10rem, 1fr) minmax(8rem, 0.7fr) auto;
  gap: 0.75rem;
  align-items: end;
  margin-top: 1.25rem;
}

.organization-review-directory__filters label {
  display: grid;
  min-width: 0;
  gap: 0.4rem;
  color: var(--ui-text-muted);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
}

.organization-review-directory__filters input,
.organization-review-directory__filters select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 2.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--ui-text);
}

.organization-review-directory__results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
  gap: 0.75rem;
  padding: 0;
  margin: 1rem 0;
  list-style: none;
}

.organization-review-directory__results button {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 0.35rem;
  padding: 0.9rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--ui-text);
  text-align: left;
  overflow-wrap: anywhere;
}

.organization-review-directory__results button[aria-pressed='true'] {
  border-color: var(--ui-primary);
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}

.organization-review-directory button:focus-visible,
.organization-review-directory input:focus-visible,
.organization-review-directory select:focus-visible {
  outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring);
  outline-offset: 2px;
}

.organization-review-directory__results span,
.organization-review-directory__status {
  color: var(--ui-text-muted);
}

.organization-review-directory__status {
  display: block;
}

.organization-review-directory__pagination {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
}

@media (max-width: 52rem) {
  .organization-review-directory__filters {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 36rem) {
  .organization-review-directory__filters {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .organization-review-directory * {
    scroll-behavior: auto;
  }
}
</style>
