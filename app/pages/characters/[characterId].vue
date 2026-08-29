<script setup lang="ts">
import { useQueryCache } from '@pinia/colada'
import { usePlatformNavigation } from '#imports'
import { characterHistoryQuery, characterSkillsQuery } from '../../queries/characters'
import { prefetchProtectedQuery } from '../../queries/query-cache'
import { walletQuery } from '../../queries/wallet'

definePageMeta({ title: 'Characters', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const { authLoading, authSession, initializeAuth } = useAuthSession(apiClient)
const { characters, refetchCharacterRoster, rosterMessage, rosterStatus } =
  useCharacterRoster(apiClient)
const callbackHandled = ref('')
const { navigation: characterNavigation } = usePlatformNavigation('character')

const characterId = computed(() => {
  const value = Array.isArray(route.params.characterId)
    ? route.params.characterId[0]
    : route.params.characterId
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
})
const selectedCharacter = computed(() =>
  characters.value.find((character) => character.characterId === characterId.value),
)
const characterBreadcrumb = computed(() => {
  const name = selectedCharacter.value?.name
  if (!name) return 'CHARACTERS'
  const section = characterSection(route.path)
  return ['CHARACTERS', name, section].filter(Boolean).join(' / ')
})

function characterSection(path: string) {
  if (path.endsWith('/skills')) return 'SKILLS'
  if (path.endsWith('/wallet')) return 'WALLET'
  if (path.endsWith('/history')) return 'HISTORY'
  if (path.endsWith('/mail')) return 'MAIL'
  return ''
}
const reauthorizeStatus = computed(() =>
  typeof route.query.reauthorize === 'string' ? route.query.reauthorize : '',
)
const reauthorizeFeedback = computed(() => {
  if (reauthorizeStatus.value === 'success') return 'Character authorization refreshed.'
  if (reauthorizeStatus.value === 'cancelled') return 'Character reauthorization was cancelled.'
  if (reauthorizeStatus.value === 'error')
    return 'Character reauthorization could not be completed.'
  return ''
})
const reauthorizeFeedbackIsError = computed(
  () => reauthorizeStatus.value !== '' && reauthorizeStatus.value !== 'success',
)

function prefetchCharacterSkills() {
  void prefetchProtectedQuery(
    queryCache,
    characterSkillsQuery({ apiClient, characterId: characterId.value ?? 0 }),
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  )
}

function prefetchCharacterWallet() {
  void prefetchProtectedQuery(
    queryCache,
    walletQuery({ apiClient, characterId: characterId.value ?? 0 }),
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  )
}

function prefetchCharacterHistory() {
  void prefetchProtectedQuery(
    queryCache,
    characterHistoryQuery({ apiClient, characterId: characterId.value ?? 0 }),
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  )
}

function prefetchCharacterNavigation(navigationId: string) {
  if (navigationId === 'core-character-skills') prefetchCharacterSkills()
  else if (navigationId === 'core-character-wallet') prefetchCharacterWallet()
  else if (navigationId === 'core-character-history') prefetchCharacterHistory()
}

function resolveCharacterNavigationPath(path: string) {
  return path.replace(':characterId', String(characterId.value))
}

watch(
  [authLoading, () => authSession.value.authenticated, reauthorizeStatus],
  async ([loading, authenticated, callbackStatus]) => {
    if (loading || !authenticated) return

    if (callbackStatus === 'success' && callbackHandled.value !== route.fullPath) {
      callbackHandled.value = route.fullPath
      await Promise.all([initializeAuth(true), refetchCharacterRoster()])
    }
  },
  { immediate: true },
)

useHead({
  title: computed(() =>
    selectedCharacter.value
      ? `${selectedCharacter.value.name} // Characters // EVE Space`
      : 'Character // EVE Space',
  ),
})
</script>

<template>
  <div class="section-page character-shell">
    <div v-if="authLoading" class="app-state-panel app-state-panel--compact" aria-live="polite">
      <div class="app-scanner" aria-hidden="true" />
      <p>Verifying account identity...</p>
    </div>
    <section v-else-if="!authSession.authenticated" class="access-locked-panel">
      <span class="access-locked-icon"><AppIcon name="auth" /></span>
      <div>
        <p class="ui-eyebrow">AUTHORIZATION REQUIRED</p>
        <h2>Character archive locked</h2>
        <p>Open the identity gateway to access added character records.</p>
      </div>
      <NuxtLink class="ui-action-primary" to="/auth">OPEN IDENTITY GATEWAY</NuxtLink>
    </section>
    <div
      v-else-if="rosterStatus === 'loading' && characters.length === 0"
      class="app-state-panel app-state-panel--compact"
      aria-live="polite"
    >
      <div class="app-scanner" aria-hidden="true" />
      <p>Resolving roster ownership...</p>
    </div>
    <div
      v-else-if="!characterId || (!selectedCharacter && rosterStatus !== 'loading')"
      class="app-state-panel app-error-panel app-state-panel--compact"
      role="alert"
    >
      <span class="app-error-code">404 / CHARACTER</span>
      <h2>Character not found</h2>
      <p>{{ rosterMessage || 'This character has not been added to your account.' }}</p>
      <NuxtLink class="ui-action-secondary" to="/characters">RETURN TO ROSTER</NuxtLink>
    </div>

    <template v-else-if="selectedCharacter">
      <header class="character-shell-header">
        <NuxtLink class="character-shell-back" to="/characters">← ALL CHARACTERS</NuxtLink>
        <div class="character-shell-identity">
          <UiEveImage kind="character" :id="selectedCharacter.characterId" :dimension="72" alt="" />
          <div>
            <p class="ui-eyebrow">{{ characterBreadcrumb }}</p>
            <h1>
              <span>{{ selectedCharacter.name }}</span>
              <UiMainCharacterMark v-if="selectedCharacter.isMain" variant="badge" />
            </h1>
            <p>
              {{ selectedCharacter.corporation.name }}
              <template v-if="selectedCharacter.alliance">
                / {{ selectedCharacter.alliance.name }}
              </template>
            </p>
          </div>
        </div>
      </header>

      <p
        v-if="reauthorizeFeedback"
        class="auth-feedback character-callback-feedback"
        :class="{ 'auth-error': reauthorizeFeedbackIsError }"
        :role="reauthorizeFeedbackIsError ? 'alert' : 'status'"
      >
        {{ reauthorizeFeedback }}
      </p>

      <nav class="character-tabs" aria-label="Character record sections">
        <NuxtLink
          v-for="navigation in characterNavigation"
          :key="navigation.navigationId"
          :to="resolveCharacterNavigationPath(navigation.to)"
          exact-active-class="is-current"
          prefetch-on="interaction"
          @pointerenter="prefetchCharacterNavigation(navigation.navigationId)"
          @focus="prefetchCharacterNavigation(navigation.navigationId)"
        >
          {{ navigation.label.toUpperCase() }}
        </NuxtLink>
      </nav>

      <NuxtPage :key="route.fullPath" />
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/features/character-record.css');
@import url('~/assets/css/pages/settings.css');
@import url('~/assets/css/responsive/record.css');
@import url('~/assets/css/responsive/settings.css');
</style>
