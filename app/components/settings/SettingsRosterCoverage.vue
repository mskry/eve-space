<script setup lang="ts">
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { coverage, errorMessage, initialize, loading } = useOrganizationRosterCoverage(apiClient)

onMounted(initialize)

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) return 'Not collected'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp),
  )
}

function statusLabel(status: string) {
  return status.replaceAll('-', ' ').toUpperCase()
}
</script>

<template>
  <section class="roster-coverage" aria-labelledby="roster-coverage-heading">
    <header class="roster-coverage__header">
      <div>
        <p class="ui-eyebrow">HR / REGISTRATION COVERAGE</p>
        <h1 id="roster-coverage-heading">Corporation roster coverage</h1>
      </div>
      <NuxtLink class="ui-action-secondary" to="/settings/integrations">BACK TO SETTINGS</NuxtLink>
    </header>

    <p class="roster-coverage__notice">
      Coverage compares observed corporation rosters with disclosed EVE Space registrations. It
      cannot discover which account owns an unregistered character or prove that every alt was
      disclosed.
    </p>
    <p v-if="errorMessage" class="ui-inline-error" role="alert">{{ errorMessage }}</p>
    <div v-if="loading && !coverage" class="roster-coverage__empty">Loading roster coverage...</div>
    <div v-else-if="!coverage" class="roster-coverage__empty">
      Roster coverage is unavailable or this account lacks HR authority.
    </div>
    <template v-else>
      <div class="roster-coverage__summary">
        <span>Managed corporation set</span>
        <strong>{{ statusLabel(coverage.managedCorporations.status) }}</strong>
        <span>{{ formatTimestamp(coverage.managedCorporations.validatedAt) }}</span>
      </div>
      <div class="roster-coverage__grid">
        <article
          v-for="corporation in coverage.corporations"
          :key="corporation.corporationId"
          class="roster-coverage__card"
        >
          <header>
            <div>
              <span>Corporation</span>
              <h2>{{ corporation.corporationId }}</h2>
            </div>
            <strong :data-status="corporation.status">{{ statusLabel(corporation.status) }}</strong>
          </header>
          <dl>
            <div>
              <dt>Data source</dt>
              <dd>{{ corporation.source?.characterId ?? 'Not configured' }}</dd>
            </div>
            <div>
              <dt>Last successful collection</dt>
              <dd>{{ formatTimestamp(corporation.validatedAt) }}</dd>
            </div>
            <div>
              <dt>Unregistered observations</dt>
              <dd>{{ corporation.unregisteredCharacters.length }}</dd>
            </div>
          </dl>
          <ul v-if="corporation.unregisteredCharacters.length" class="roster-coverage__characters">
            <li
              v-for="character in corporation.unregisteredCharacters"
              :key="character.characterId"
            >
              <strong>{{ character.characterId }}</strong>
              <span>Observed {{ formatTimestamp(character.observedAt) }}</span>
            </li>
          </ul>
          <p v-else class="roster-coverage__complete">
            No unregistered characters appear in the latest retained observation.
          </p>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.roster-coverage {
  display: grid;
  gap: 1.5rem;
  padding: clamp(1rem, 3vw, 2.5rem);
}

.roster-coverage__header,
.roster-coverage__card header,
.roster-coverage__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.roster-coverage__header h1,
.roster-coverage__card h2 {
  margin: 0.25rem 0 0;
}

.roster-coverage__notice,
.roster-coverage__summary,
.roster-coverage__card,
.roster-coverage__empty {
  border: 1px solid var(--ui-border-default);
  background: var(--ui-surface-raised);
}

.roster-coverage__notice,
.roster-coverage__summary,
.roster-coverage__empty {
  margin: 0;
  padding: 1rem;
}

.roster-coverage__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
  gap: 1rem;
}

.roster-coverage__card {
  padding: 1rem;
}

.roster-coverage__card dl {
  display: grid;
  gap: 0.75rem;
}

.roster-coverage__card dl div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.roster-coverage__card dt,
.roster-coverage__characters span {
  color: var(--ui-text-muted);
}

.roster-coverage__characters {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  list-style: none;
}

.roster-coverage__characters li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--ui-border-subtle);
  padding-top: 0.5rem;
}

.roster-coverage__complete {
  color: var(--ui-text-muted);
}

@media (max-width: 40rem) {
  .roster-coverage__header,
  .roster-coverage__summary,
  .roster-coverage__characters li {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
