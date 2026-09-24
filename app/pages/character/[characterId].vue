<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import CharacterOverviewBioCard from '../../components/character/CharacterOverviewBioCard.vue'
import CharacterOverviewDetails from '../../components/character/CharacterOverviewDetails.vue'
import type { RecordSectionNavigationEntry } from '../../types/record-navigation'
import { publicCharacterQuery } from '../../queries/characters'
import { ApiQueryError } from '../../utils/query-error'
import { parseRouteId } from '../../utils/route-id'

definePageMeta({ layout: 'headerless', title: 'Character' })

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
  if (!characterId.value) {
    return 'not-found'
  }
  if (authLoading.value) {
    return 'loading'
  }
  if (!recordAccessAllowed.value) {
    return 'idle'
  }
  if (detailQuery.data.value) {
    return 'idle'
  }
  if (detailQuery.error.value instanceof ApiQueryError && detailQuery.error.value.status === 404) {
    return 'not-found'
  }
  if (detailQuery.status.value === 'error') {
    return 'error'
  }
  if (detailQuery.asyncStatus.value === 'loading') {
    return 'loading'
  }
  return 'idle'
})
const detailMessage = computed(() =>
  detailQuery.error.value instanceof Error ? detailQuery.error.value.message : '',
)
const navigation = computed<readonly RecordSectionNavigationEntry[]>(() =>
  characterId.value === undefined
    ? []
    : [
        {
          exact: true,
          id: 'overview',
          label: 'OVERVIEW',
          to: `/character/${characterId.value}`,
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
        <NuxtLink class="character-shell-back" to="/characters">← ALL CHARACTERS</NuxtLink>
        <div class="character-shell-identity character-shell-identity--record">
          <span class="character-shell-portrait">
            <UiEveImage
              kind="character"
              :id="profile.id"
              :dimension="72"
              :width="72"
              :height="72"
              loading="eager"
              decoding="async"
              alt=""
            />
          </span>
          <div>
            <p class="ui-eyebrow">CHARACTER / OVERVIEW</p>
            <h1>{{ profile.name }}</h1>
            <p class="character-shell-record-affiliations">
              <NuxtLink :to="`/corporation/${profile.corporation.id}`">
                {{ profile.corporation.name }}
              </NuxtLink>
              <template v-if="profile.alliance"> / {{ profile.alliance.name }} </template>
            </p>
          </div>
        </div>
      </header>

      <RecordSectionNavigation :entries="navigation" label="Character record sections" />

      <article class="dossier">
        <div class="identity-panel">
          <div class="character-record-grid">
            <section
              class="overview-summary-grid character-overview-record-grid"
              aria-label="Character biography, identity, and progression"
            >
              <div class="character-overview-primary-column">
                <CharacterOverviewBioCard :bio="profile.bio" />
              </div>
              <CharacterOverviewDetails :profile="profile" />
            </section>
          </div>
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
