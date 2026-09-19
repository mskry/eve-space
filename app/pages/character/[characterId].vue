<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import type { RecordSectionNavigationEntry } from '../../types/record-navigation'
import { publicCharacterQuery } from '../../queries/characters'
import { ApiQueryError } from '../../utils/query-error'
import { parseRouteId } from '../../utils/route-id'

definePageMeta({ title: 'Character', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const recordAccessAllowed = computed(() => !authLoading.value && authSession.value.authenticated)
const detailQuery = useQuery(() => ({
  ...publicCharacterQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: import.meta.client && recordAccessAllowed.value && characterId.value !== undefined,
}))
const profile = computed(() =>
  recordAccessAllowed.value ? detailQuery.data.value?.profile : undefined,
)
const detailStatus = computed(() => {
  if (!characterId.value) return 'not-found'
  if (authLoading.value) return 'loading'
  if (!recordAccessAllowed.value) return 'idle'
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
const navigation = computed<readonly RecordSectionNavigationEntry[]>(() =>
  characterId.value === undefined
    ? []
    : [
        {
          id: 'overview',
          label: 'OVERVIEW',
          to: `/character/${characterId.value}`,
          exact: true,
        },
      ],
)

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
          <span class="character-shell-portrait character-shell-portrait--large">
            <UiEveImage
              kind="character"
              :id="profile.id"
              :dimension="96"
              :width="96"
              :height="96"
              loading="eager"
              decoding="async"
              :alt="`${profile.name} character portrait`"
            />
          </span>
          <div>
            <p class="ui-eyebrow">PUBLIC CHARACTER RECORD</p>
            <h1>{{ profile.name }}</h1>
            <div class="character-shell-organization">
              <NuxtLink
                class="character-shell-organization-link"
                :to="`/corporation/${profile.corporation.id}`"
              >
                <UiEveImage
                  kind="corporation"
                  :id="profile.corporation.id"
                  :dimension="32"
                  :width="32"
                  :height="32"
                  loading="lazy"
                  decoding="async"
                  :alt="`${profile.corporation.name} corporation logo`"
                />
                <strong>{{ profile.corporation.name }}</strong>
              </NuxtLink>
              <span v-if="profile.alliance" class="character-shell-organization-alliance">
                <UiEveImage
                  kind="alliance"
                  :id="profile.alliance.id"
                  :dimension="32"
                  :width="32"
                  :height="32"
                  loading="lazy"
                  decoding="async"
                  :alt="`${profile.alliance.name} alliance logo`"
                />
                <strong>{{ profile.alliance.name }}</strong>
              </span>
            </div>
          </div>
        </div>
      </header>

      <RecordSectionNavigation :entries="navigation" label="Character record sections" />

      <article class="dossier">
        <div class="identity-panel">
          <section
            class="overview-summary-grid"
            aria-label="Character biography, identity, and public record"
          >
            <div class="overview-bio-card">
              <span class="card-index">01</span>
              <p>BIO</p>
              <div class="overview-bio-copy">
                <EveFormattedText v-if="profile.bio" :value="profile.bio" />
                <template v-else>No biography recorded.</template>
              </div>
            </div>
            <section class="character-overview-detail-card">
              <span class="card-index">02</span>
              <section
                class="character-overview-detail-section character-overview-detail-section--identity"
              >
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
              <section
                class="character-overview-detail-section character-overview-detail-section--public-record"
              >
                <h2>PUBLIC RECORD</h2>
                <dl>
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
                        :width="32"
                        :height="32"
                        loading="lazy"
                        decoding="async"
                        alt="Faction militia emblem"
                      />
                    </dd>
                  </div>
                  <div class="character-detail-wide">
                    <dt>SECURITY STATUS</dt>
                    <dd><SecurityStatus :value="profile.securityStatus" /></dd>
                  </div>
                </dl>
              </section>
            </section>
          </section>
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
