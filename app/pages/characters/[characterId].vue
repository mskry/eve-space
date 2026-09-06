<script setup lang="ts">
import {
  provideCharacterReauthorization,
  type ReauthorizeStatus,
} from '../../composables/useCharacterReauthorization'
import { parseRouteId } from '../../utils/route-id'

definePageMeta({ title: 'Characters', layout: 'headerless' })

const route = useRoute()
const router = useRouter()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession, refreshAuthContext } = useAuthSession(apiClient)
const { characters, refetchCharacterRoster, rosterMessage, rosterStatus } =
  useCharacterRoster(apiClient)
const callbackProcessing = ref(false)
const reauthorizeFeedbackStatus = ref<ReauthorizeStatus>('')
const reauthorizationCycle = provideCharacterReauthorization()

const characterId = computed(() => parseRouteId(route.params.characterId))
const authenticated = computed(() => authSession.value.authenticated)
const selectedCharacter = computed(() =>
  characters.value.find((character) => character.characterId === characterId.value),
)
const ownsCharacter = computed(() => selectedCharacter.value !== undefined)
const {
  breadcrumbLabel: characterSectionLabel,
  entries: characterNavigation,
  prefetchNavigation: prefetchCharacterNavigation,
} = useCharacterRecordNavigation({ apiClient, authenticated, characterId, ownsCharacter })
const characterBreadcrumb = computed(() => {
  const name = selectedCharacter.value?.name
  if (!name) return 'CHARACTERS'
  return ['CHARACTERS', name, characterSectionLabel.value].filter(Boolean).join(' / ')
})
const reauthorizeStatus = computed<ReauthorizeStatus>(() => {
  const status = route.query.reauthorize
  return status === 'success' || status === 'cancelled' || status === 'error' ? status : ''
})
const reauthorizeFeedback = computed(() => {
  if (reauthorizeFeedbackStatus.value === 'success') return 'Character authorization refreshed.'
  if (reauthorizeFeedbackStatus.value === 'cancelled')
    return 'Character reauthorization was cancelled.'
  if (reauthorizeFeedbackStatus.value === 'error')
    return 'Character reauthorization could not be completed.'
  return ''
})
const reauthorizeFeedbackIsError = computed(
  () => reauthorizeFeedbackStatus.value !== '' && reauthorizeFeedbackStatus.value !== 'success',
)
const characterPageKey = computed(
  () => router.resolve(routeLocationWithoutReauthorization()).fullPath,
)

function routeLocationWithoutReauthorization() {
  const query = { ...route.query }
  delete query.reauthorize
  return { path: route.path, query, hash: route.hash }
}

watch(characterId, (id, previousId) => {
  if (id !== previousId) reauthorizeFeedbackStatus.value = ''
})

watch(
  [authLoading, () => authSession.value.authenticated, reauthorizeStatus],
  async ([loading, sessionAuthenticated, callbackStatus]) => {
    if (loading || !sessionAuthenticated || !callbackStatus || callbackProcessing.value) return

    callbackProcessing.value = true
    reauthorizeFeedbackStatus.value = callbackStatus
    reauthorizationCycle.begin(callbackStatus)
    await Promise.allSettled([refreshAuthContext(), refetchCharacterRoster()])

    try {
      await router.replace(routeLocationWithoutReauthorization())
    } finally {
      reauthorizationCycle.finish()
      callbackProcessing.value = false
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
    <UiStatePanel v-if="authLoading && !callbackProcessing" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Verifying account identity...</p>
    </UiStatePanel>
    <section
      v-else-if="!authSession.authenticated && !callbackProcessing"
      class="access-locked-panel"
    >
      <span class="access-locked-icon"><AppIcon name="auth" /></span>
      <div>
        <p class="ui-eyebrow">AUTHORIZATION REQUIRED</p>
        <h2>Character archive locked</h2>
        <p>Open the identity gateway to access added character records.</p>
      </div>
      <NuxtLink class="ui-action-primary" to="/auth">OPEN IDENTITY GATEWAY</NuxtLink>
    </section>
    <UiStatePanel
      v-else-if="rosterStatus === 'loading' && characters.length === 0"
      compact
      role="status"
    >
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Resolving roster ownership...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="!characterId || (!selectedCharacter && rosterStatus !== 'loading')"
      code="404 / CHARACTER"
      title="Character not found"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ rosterMessage || 'This character has not been added to your account.' }}</p>
      <template #action>
        <NuxtLink class="ui-action-secondary" to="/characters">RETURN TO ROSTER</NuxtLink>
      </template>
    </UiStatePanel>

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

      <RecordSectionNavigation
        :entries="characterNavigation"
        label="Character record sections"
        @intent="prefetchCharacterNavigation"
      />

      <NuxtPage :key="characterPageKey" />
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/features/character-record.css');
@import url('~/assets/css/features/character-access.css');
@import url('~/assets/css/responsive/record.css');
</style>
