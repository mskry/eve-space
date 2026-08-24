<script setup lang="ts">
import { useQueryCache } from '@pinia/colada'
import { characterHistoryQuery, characterSkillsQuery } from '../../queries/characters'
import { prefetchProtectedQuery } from '../../queries/query-cache'
import { walletQuery } from '../../queries/wallet'

definePageMeta({ title: 'Characters', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const { characterPortrait } = useEveImages()
const { authLoading, authSession, initializeAuth } = useAuthSession(apiClient)
const { characters, loadCharacterRoster, rosterMessage, rosterStatus } =
  useCharacterRoster(apiClient)
const callbackHandled = ref('')

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
  const section = route.path.endsWith('/skills')
    ? 'SKILLS'
    : route.path.endsWith('/wallet')
      ? 'WALLET'
      : route.path.endsWith('/history')
        ? 'HISTORY'
        : ''
  return ['CHARACTERS', name, section].filter(Boolean).join(' / ')
})
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

watch(
  [authLoading, () => authSession.value.authenticated, reauthorizeStatus],
  async ([loading, authenticated, callbackStatus]) => {
    if (loading || !authenticated) return

    if (callbackStatus === 'success' && callbackHandled.value !== route.fullPath) {
      callbackHandled.value = route.fullPath
      await Promise.all([initializeAuth(true), loadCharacterRoster(true)])
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
    <div v-if="authLoading" class="state-panel compact-state" aria-live="polite">
      <div class="scanner" aria-hidden="true" />
      <p>Verifying account identity...</p>
    </div>
    <section v-else-if="!authSession.authenticated" class="locked-panel">
      <span class="locked-icon"><AppIcon name="auth" /></span>
      <div>
        <p class="eyebrow">AUTHORIZATION REQUIRED</p>
        <h2>Character archive locked</h2>
        <p>Open the identity gateway to access added character records.</p>
      </div>
      <NuxtLink class="primary-action" to="/auth">OPEN IDENTITY GATEWAY</NuxtLink>
    </section>
    <div
      v-else-if="rosterStatus === 'loading' && characters.length === 0"
      class="state-panel compact-state"
      aria-live="polite"
    >
      <div class="scanner" aria-hidden="true" />
      <p>Resolving roster ownership...</p>
    </div>
    <div
      v-else-if="!characterId || (!selectedCharacter && rosterStatus !== 'loading')"
      class="state-panel error-panel compact-state"
      role="alert"
    >
      <span class="error-code">404 / CHARACTER</span>
      <h2>Character not found</h2>
      <p>{{ rosterMessage || 'This character has not been added to your account.' }}</p>
      <NuxtLink class="secondary-action" to="/characters">RETURN TO ROSTER</NuxtLink>
    </div>

    <template v-else-if="selectedCharacter">
      <header class="character-shell-header">
        <NuxtLink class="character-shell-back" to="/characters">← ALL CHARACTERS</NuxtLink>
        <div class="character-shell-identity">
          <img
            :src="characterPortrait(selectedCharacter.characterId, 128)"
            :srcset="`${characterPortrait(selectedCharacter.characterId, 128)} 1x, ${characterPortrait(selectedCharacter.characterId, 256)} 2x`"
            alt=""
            width="72"
            height="72"
          />
          <div>
            <p class="eyebrow">{{ characterBreadcrumb }}</p>
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
          :to="`/characters/${selectedCharacter.characterId}`"
          exact-active-class="is-current"
        >
          OVERVIEW
        </NuxtLink>
        <NuxtLink
          :to="`/characters/${selectedCharacter.characterId}/skills`"
          exact-active-class="is-current"
          prefetch-on="interaction"
          @pointerenter="prefetchCharacterSkills"
          @focus="prefetchCharacterSkills"
        >
          SKILLS
        </NuxtLink>
        <NuxtLink
          :to="`/characters/${selectedCharacter.characterId}/wallet`"
          exact-active-class="is-current"
          prefetch-on="interaction"
          @pointerenter="prefetchCharacterWallet"
          @focus="prefetchCharacterWallet"
        >
          WALLET
        </NuxtLink>
        <NuxtLink
          :to="`/characters/${selectedCharacter.characterId}/history`"
          exact-active-class="is-current"
          prefetch-on="interaction"
          @pointerenter="prefetchCharacterHistory"
          @focus="prefetchCharacterHistory"
        >
          HISTORY
        </NuxtLink>
      </nav>

      <NuxtPage :key="route.fullPath" />
    </template>
  </div>
</template>
