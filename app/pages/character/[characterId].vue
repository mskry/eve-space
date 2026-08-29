<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { publicCharacterQuery } from '../../queries/characters'
import { ApiQueryError } from '../../utils/query-error'
import { parseRouteId } from '../../utils/route-id'

definePageMeta({ title: 'Character', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const characterId = computed(() => parseRouteId(route.params.characterId))
const detailQuery = useQuery(() => ({
  ...publicCharacterQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: import.meta.client && characterId.value !== undefined,
}))
const profile = computed(() => detailQuery.data.value?.profile)
const detailStatus = computed(() => {
  if (!characterId.value) return 'not-found'
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
const formattedBirthday = computed(() =>
  profile.value ? formatBirthday(profile.value.birthday) : '',
)
const genderSymbol = computed(() => {
  const gender = profile.value?.gender.toLowerCase()
  if (gender === 'female') return '♀'
  if (gender === 'male') return '♂'
  return '—'
})

useHead({
  title: computed(() =>
    profile.value ? `${profile.value.name} // Character // EVE Space` : 'Character // EVE Space',
  ),
})
</script>

<template>
  <div class="section-page character-shell">
    <UiStatePanel v-if="detailStatus === 'loading'" role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Resolving public character record...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="detailStatus === 'not-found'"
      code="404 / CHARACTER"
      title="Character not found"
      role="alert"
      tone="error"
    >
      <p>ESI has no public record for ID {{ characterId ?? '—' }}.</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="$router.back()">GO BACK</button>
      </template>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="detailStatus === 'error'"
      code="ERR / ESI"
      title="Record unavailable"
      role="alert"
      tone="error"
    >
      <p>{{ detailMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="detailQuery.refresh()">
          RETRY
        </button>
      </template>
    </UiStatePanel>

    <template v-else-if="profile">
      <header class="character-shell-header">
        <button class="character-shell-back" type="button" @click="$router.back()">← BACK</button>
        <div class="character-shell-identity">
          <UiEveImage
            kind="character"
            :id="profile.id"
            :dimension="72"
            :alt="`${profile.name} character portrait`"
          />
          <div>
            <p class="ui-eyebrow">PUBLIC CHARACTER RECORD</p>
            <h1>{{ profile.name }}</h1>
            <p>
              {{ profile.corporation.name }}
              <template v-if="profile.alliance"> / {{ profile.alliance.name }}</template>
            </p>
          </div>
        </div>
      </header>

      <article class="dossier">
        <div class="identity-panel">
          <section
            class="overview-summary-grid"
            :class="{ 'overview-summary-grid--single-affiliation': !profile.alliance }"
            aria-label="Character biography and affiliations"
          >
            <div class="overview-bio-card">
              <span class="card-index">01</span>
              <p>BIO</p>
              <div class="overview-bio-copy">{{ profile.bio || 'No biography recorded.' }}</div>
            </div>
            <section class="affiliation-card">
              <span class="card-index">02</span>
              <p>CORPORATION</p>
              <NuxtLink class="affiliation-identity" :to="`/corporation/${profile.corporation.id}`">
                <UiEveImage
                  kind="corporation"
                  :id="profile.corporation.id"
                  :dimension="48"
                  :alt="`${profile.corporation.name} corporation logo`"
                />
                <div class="affiliation-copy">
                  <h2>
                    <span class="affiliation-ticker">[{{ profile.corporation.ticker }}]</span>
                    {{ profile.corporation.name }}
                  </h2>
                  <div class="affiliation-meta">
                    <span
                      >{{ profile.corporation.memberCount.toLocaleString('en-US') }} MEMBERS</span
                    >
                  </div>
                </div>
              </NuxtLink>
            </section>
            <section v-if="profile.alliance" class="affiliation-card">
              <span class="card-index">03</span>
              <p>ALLIANCE</p>
              <div class="affiliation-identity">
                <UiEveImage
                  kind="alliance"
                  :id="profile.alliance.id"
                  :dimension="48"
                  :alt="`${profile.alliance.name} alliance logo`"
                />
                <div class="affiliation-copy">
                  <h2>
                    <span class="affiliation-ticker">[{{ profile.alliance.ticker }}]</span>
                    {{ profile.alliance.name }}
                  </h2>
                  <div class="affiliation-meta"><span>ACTIVE AFFILIATION</span></div>
                </div>
              </div>
            </section>
          </section>

          <section
            class="character-detail-groups public-character-detail-groups"
            aria-label="Public character details"
          >
            <section class="character-detail-group character-detail-group--identity">
              <h2>IDENTITY</h2>
              <dl>
                <div class="character-detail-col-start">
                  <dt>RACE</dt>
                  <dd>{{ profile.race }}</dd>
                </div>
                <div class="character-detail-col-end">
                  <dt>BLOODLINE</dt>
                  <dd>{{ profile.bloodline }}</dd>
                </div>
                <div class="character-detail-col-start">
                  <dt>DATE OF BIRTH</dt>
                  <dd>{{ formattedBirthday }}</dd>
                </div>
                <div class="character-detail-col-end">
                  <dt>GENDER</dt>
                  <dd>
                    <span class="gender-symbol" :title="profile.gender" aria-hidden="true">{{
                      genderSymbol
                    }}</span>
                    <span class="sr-only">{{ profile.gender }}</span>
                  </dd>
                </div>
              </dl>
            </section>
            <section class="character-detail-group character-detail-group--public-record">
              <h2>PUBLIC RECORD</h2>
              <dl>
                <div>
                  <dt>SECURITY STATUS</dt>
                  <dd><SecurityStatus :value="profile.securityStatus" /></dd>
                </div>
                <div>
                  <dt>ACHIEVEMENT SCORE</dt>
                  <dd>{{ profile.achievementScore.toLocaleString('en-US') }}</dd>
                </div>
                <div v-if="profile.corporationTitle">
                  <dt>CORPORATION TITLE</dt>
                  <dd>{{ profile.corporationTitle }}</dd>
                </div>
                <div v-if="profile.factionId">
                  <dt>FACTION WARFARE</dt>
                  <dd>
                    <UiEveImage
                      kind="faction"
                      :id="profile.factionId"
                      :dimension="32"
                      alt="Faction militia emblem"
                    />
                  </dd>
                </div>
              </dl>
            </section>
          </section>

          <footer class="record-footer">
            <a
              :href="`https://evewho.com/character/${profile.id}`"
              target="_blank"
              rel="noreferrer"
            >
              EXTERNAL RECORD ↗
            </a>
          </footer>
        </div>
      </article>
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/features/record-dossier.css');
@import url('~/assets/css/features/character-record.css');
@import url('~/assets/css/responsive/record.css');
</style>

<style scoped>
.public-character-detail-groups {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 760px) {
  .public-character-detail-groups {
    grid-template-columns: 1fr;
  }
}
</style>
