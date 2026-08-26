<script setup lang="ts">
import { corporationAllianceHistoryQuery, corporationQuery } from '../../../queries/corporations'

definePageMeta({ title: 'Corporation', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const activeTab = ref<'overview' | 'alliance-history'>('overview')

const corporationId = computed(() => {
  const value = Array.isArray(route.params.corporationId)
    ? route.params.corporationId[0]
    : route.params.corporationId
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
})

const detailQuery = useQuery(() => ({
  ...corporationQuery({ apiClient, corporationId: corporationId.value ?? 0 }),
  enabled: corporationId.value !== undefined,
}))

const historyQuery = useQuery(() => ({
  ...corporationAllianceHistoryQuery({ apiClient, corporationId: corporationId.value ?? 0 }),
  enabled: corporationId.value !== undefined,
}))

const corporation = computed(() => detailQuery.data.value?.corporation)
const history = computed(() => historyQuery.data.value?.history ?? [])
const canShowAllianceHistory = computed(() => {
  // Keep the tab available until the response is known so failures remain actionable.
  if (historyQuery.status.value === 'error') return true
  if (historyQuery.data.value === undefined) return true
  return history.value.length > 0
})
watch(canShowAllianceHistory, (visible) => {
  if (!visible && activeTab.value === 'alliance-history') activeTab.value = 'overview'
})

const detailStatus = computed(() => {
  if (!corporationId.value) return 'not-found'
  if (detailQuery.data.value) return 'idle'
  if (detailQuery.error.value instanceof ApiQueryError && detailQuery.error.value.status === 404) {
    return 'not-found'
  }
  if (detailQuery.status.value === 'error') return 'error'
  if (detailQuery.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})

const detailMessage = computed(() =>
  detailQuery.error.value instanceof Error ? detailQuery.error.value.message : '',
)

const formattedFounded = computed(() =>
  corporation.value?.dateFounded ? formatBirthday(corporation.value.dateFounded) : '—',
)

useHead({
  title: computed(() =>
    corporation.value
      ? `${corporation.value.name} [${corporation.value.ticker}] // Corporations // EVE Space`
      : 'Corporation // EVE Space',
  ),
})
</script>

<template>
  <div class="section-page character-shell">
    <div v-if="detailStatus === 'loading'" class="app-state-panel" aria-live="polite">
      <div class="app-scanner" aria-hidden="true" />
      <p>Resolving corporation record...</p>
    </div>
    <div
      v-else-if="detailStatus === 'not-found'"
      class="app-state-panel app-error-panel"
      role="alert"
    >
      <span class="app-error-code">404 / CORPORATION</span>
      <h2>Corporation not found</h2>
      <p>ESI has no public record for ID {{ corporationId ?? '—' }}.</p>
      <button class="ui-action-secondary" type="button" @click="$router.back()">GO BACK</button>
    </div>
    <div v-else-if="detailStatus === 'error'" class="app-state-panel app-error-panel" role="alert">
      <span class="app-error-code">ERR / ESI</span>
      <h2>Record unavailable</h2>
      <p>{{ detailMessage }}</p>
      <button class="ui-action-secondary" type="button" @click="detailQuery.refresh()">
        RETRY
      </button>
    </div>

    <template v-else-if="corporation">
      <header class="character-shell-header">
        <button class="character-shell-back" type="button" @click="$router.back()">← BACK</button>
        <div class="character-shell-identity">
          <UiEveImage
            kind="corporation"
            :id="corporation.corporationId"
            :dimension="72"
            :alt="`${corporation.name} corporation logo`"
          />
          <div>
            <p class="ui-eyebrow">CORPORATION / {{ corporation.ticker }}</p>
            <h1>
              <span>{{ corporation.name }}</span>
            </h1>
            <p>
              {{ corporation.memberCount.toLocaleString('en-US') }} MEMBERS · Tax
              {{ corporation.taxRate !== null ? `${corporation.taxRate.toFixed(1)}%` : '—'
              }}<template v-if="corporation.allianceName">
                · {{ corporation.allianceName }}</template
              ><template v-else-if="corporation.allianceId">
                · Alliance {{ corporation.allianceId }}</template
              ><template v-if="corporation.factionId">
                · Faction {{ corporation.factionId }}</template
              ><template v-if="corporation.type !== 'player_owned'">
                ·
                {{
                  corporation.type === 'npc_owned' ? 'NPC' : corporation.type.toUpperCase()
                }}</template
              >
            </p>
          </div>
        </div>
      </header>

      <nav
        v-if="canShowAllianceHistory"
        class="character-tabs"
        aria-label="Corporation record sections"
      >
        <button
          type="button"
          :class="{ 'is-current': activeTab === 'overview' }"
          :aria-current="activeTab === 'overview' ? 'page' : undefined"
          @click="activeTab = 'overview'"
        >
          OVERVIEW
        </button>
        <button
          type="button"
          :class="{ 'is-current': activeTab === 'alliance-history' }"
          :aria-current="activeTab === 'alliance-history' ? 'page' : undefined"
          @click="activeTab = 'alliance-history'"
        >
          ALLIANCE HISTORY
        </button>
      </nav>
      <nav
        v-else
        class="character-tabs character-tabs--single"
        aria-label="Corporation record sections"
      >
        <span class="is-current" aria-current="page">OVERVIEW</span>
      </nav>

      <article v-if="canShowAllianceHistory ? activeTab === 'overview' : true" class="dossier">
        <div class="identity-panel">
          <div class="corporation-body" aria-label="Corporation dossier">
            <div class="overview-bio-card corporation-bio">
              <span class="card-index">01</span>
              <p>DESCRIPTION</p>
              <div class="overview-bio-copy">
                {{ corporation.description || 'No public description.' }}
              </div>
              <p v-if="corporation.url" class="corporation-url">
                {{ corporation.url }}
              </p>
            </div>
            <div class="corporation-side">
              <section class="character-detail-group character-detail-group--membership">
                <span class="card-index">02</span>
                <h2>CORPORATION</h2>
                <dl>
                  <div class="character-detail-primary">
                    <dt>MEMBERS</dt>
                    <dd>{{ corporation.memberCount.toLocaleString('en-US') }}</dd>
                  </div>
                  <div class="membership-founded">
                    <dt>FOUNDED</dt>
                    <dd>{{ formattedFounded }}</dd>
                  </div>
                  <div
                    v-if="corporation.shares !== null && corporation.shares !== 0"
                    class="membership-shares"
                  >
                    <dt>SHARES</dt>
                    <dd>{{ corporation.shares.toLocaleString('en-US') }}</dd>
                  </div>
                  <div v-if="corporation.homeStationId" class="membership-home">
                    <dt>HOME STATION</dt>
                    <dd>{{ corporation.homeStationName ?? corporation.homeStationId }}</dd>
                  </div>
                </dl>
              </section>
              <section class="character-detail-group character-detail-group--leadership">
                <h2>LEADERSHIP</h2>
                <dl>
                  <div class="leadership-ceo">
                    <dt>CEO</dt>
                    <dd class="corporation-ceo">
                      <template v-if="corporation.ceoId !== null">
                        <NuxtLink
                          class="corporation-character-link"
                          :to="`/character/${corporation.ceoId}`"
                        >
                          <UiEveImage
                            kind="character"
                            :id="corporation.ceoId"
                            :dimension="32"
                            :alt="`${corporation.ceoName ?? `CEO ${corporation.ceoId}`} portrait`"
                          />
                          <span>{{ corporation.ceoName ?? `ID ${corporation.ceoId}` }}</span>
                        </NuxtLink>
                      </template>
                      <span v-else>—</span>
                    </dd>
                  </div>
                  <div v-if="corporation.creatorId !== null" class="leadership-creator">
                    <dt>CREATOR</dt>
                    <dd class="corporation-ceo">
                      <NuxtLink
                        class="corporation-character-link"
                        :to="`/character/${corporation.creatorId}`"
                      >
                        <UiEveImage
                          kind="character"
                          :id="corporation.creatorId"
                          :dimension="32"
                          :alt="`${corporation.creatorName ?? `Creator ${corporation.creatorId}`} portrait`"
                        />
                        <span>{{ corporation.creatorName ?? `ID ${corporation.creatorId}` }}</span>
                      </NuxtLink>
                    </dd>
                  </div>
                  <div v-if="corporation.allianceId" class="leadership-alliance">
                    <dt>ALLIANCE</dt>
                    <dd class="corporation-alliance">
                      <UiEveImage
                        kind="alliance"
                        :id="corporation.allianceId"
                        :dimension="32"
                        :alt="`${corporation.allianceName ?? `Alliance ${corporation.allianceId}`} logo`"
                      />
                      <span>{{ corporation.allianceName ?? `ID ${corporation.allianceId}` }}</span>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
          <footer class="record-footer">
            <a
              :href="`https://evewho.com/corporation/${corporation.corporationId}`"
              target="_blank"
              rel="noreferrer"
            >
              EXTERNAL RECORD ↗
            </a>
          </footer>
        </div>
      </article>

      <template v-else>
        <div
          v-if="historyQuery.asyncStatus.value === 'loading'"
          class="corporation-history-loading"
        >
          Loading…
        </div>
        <div v-else-if="historyQuery.status.value === 'error'" class="ui-inline-error" role="alert">
          Alliance history unavailable.
          <button type="button" class="ui-action-secondary" @click="historyQuery.refresh()">
            RETRY
          </button>
        </div>
        <AllianceHistoryTimeline v-else :history="history" />
      </template>
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/features/record-dossier.css');
@import url('~/assets/css/features/character-record.css');
@import url('~/assets/css/responsive/record.css');
</style>

<style scoped>
.corporation-body {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.corporation-bio {
  border-right: 1px solid var(--line);
}
.corporation-bio .overview-bio-copy {
  max-height: none;
}
.corporation-side {
  display: grid;
  min-width: 0;
}
.corporation-side .affiliation-card,
.corporation-side .character-detail-group {
  border-right: 0;
}
.character-detail-group--membership {
  position: relative;
}
.character-detail-group--membership dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.character-detail-group--membership .character-detail-primary,
.character-detail-group--membership .membership-home {
  grid-column: 1 / -1;
}
.character-detail-group--membership .membership-founded {
  grid-column: 1;
  padding-right: 12px;
}
.character-detail-group--membership .membership-shares {
  grid-column: 2;
  padding-left: 12px;
}
.character-detail-group--membership .membership-founded:has(+ .membership-home) {
  grid-column: 1 / -1;
  padding-right: 0;
}
.character-detail-group--leadership dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.character-detail-group--leadership .leadership-ceo {
  grid-column: 1;
  padding-right: 12px;
}
.character-detail-group--leadership .leadership-creator {
  grid-column: 2;
  padding-left: 12px;
}
.character-detail-group--leadership .leadership-alliance {
  grid-column: 1 / -1;
}
.character-detail-group--leadership
  .leadership-ceo:not(:has(+ .leadership-creator)):has(+ .leadership-alliance),
.character-detail-group--leadership .leadership-ceo:last-child {
  grid-column: 1 / -1;
  padding-right: 0;
}
.character-tabs button {
  cursor: pointer;
}
@media (max-width: 900px) {
  .corporation-body {
    grid-template-columns: 1fr;
    border-bottom: 0;
  }
  .corporation-bio {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .corporation-side {
    border-bottom: 1px solid var(--line);
  }
}
.corporation-url {
  display: inline-block;
  margin-top: 10px;
  font: 12px/1 var(--ui-font-mono);
  word-break: break-all;
}
.corporation-ceo,
.corporation-alliance {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.corporation-character-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  text-decoration: none;
}
.corporation-character-link:hover {
  color: var(--ui-primary);
}
.corporation-character-link:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}
.corporation-ceo img,
.corporation-alliance img {
  border: 1px solid var(--line);
}
.corporation-war-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.corporation-war-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font: 12px/1.4 var(--ui-font-mono);
  padding: 6px 8px;
  border: 1px solid var(--line);
  background: var(--ui-surface);
}
.corporation-war-list small {
  color: var(--ui-text-faint);
  white-space: nowrap;
}
.corporation-history-loading {
  font: 12px/1 var(--ui-font-mono);
  color: var(--ui-text-faint);
}
.corporation-id-badge {
  font: 10px/1 var(--ui-font-mono);
  letter-spacing: 0.06em;
  color: var(--ui-text-faint);
  border: 1px solid var(--line);
  padding: 4px 6px;
}
.record-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  border-top: 0;
}
</style>
