<script setup lang="ts">
import { useQueryCache } from '@pinia/colada'
import { characterOverviewQuery, type CharacterRosterEntry } from '../../queries/characters'
import { prefetchProtectedQuery } from '../../queries/query-cache'

definePageMeta({ title: 'Characters', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const { authLoading, authSession, initializeAuth } = useAuthSession(apiClient)
const {
  attachCharacter,
  characters,
  deleteCharacterPending,
  loadCharacterRoster,
  mainCharacterPending,
  rosterMessage,
  rosterStatus,
  removeCharacter,
  selectMainCharacter,
} = useCharacterRoster(apiClient)
const callbackHandled = ref('')
const deleteCandidate = ref<CharacterRosterEntry>()
const deleteDialogOpen = ref(false)
const deleteDialogError = ref('')

const attachStatus = computed(() =>
  typeof route.query.attach === 'string' ? route.query.attach : '',
)
const attachFeedback = computed(() => {
  if (attachStatus.value === 'success')
    return 'Character authorization completed. Roster synchronized.'
  if (attachStatus.value === 'conflict') {
    return 'That character is already added to another EVE Space account.'
  }
  if (attachStatus.value === 'cancelled') return 'Adding the character was cancelled.'
  if (attachStatus.value === 'error') return 'The character could not be added.'
  return ''
})
const attachFeedbackIsError = computed(
  () => attachStatus.value !== '' && attachStatus.value !== 'success',
)

function prefetchCharacterOverview(characterId: number) {
  void prefetchProtectedQuery(
    queryCache,
    characterOverviewQuery({ apiClient, characterId }),
    import.meta.client,
    authSession.value.authenticated,
    characterId,
  )
}

function requestCharacterDeletion(character: CharacterRosterEntry) {
  deleteCandidate.value = character
  deleteDialogError.value = ''
  globalThis.setTimeout(() => {
    deleteDialogOpen.value = true
  })
}

async function confirmCharacterDeletion() {
  if (!deleteCandidate.value) return
  const deleted = await removeCharacter(deleteCandidate.value.characterId)
  if (deleted) {
    deleteDialogOpen.value = false
    return
  }
  deleteDialogError.value = rosterMessage.value || 'Character could not be deleted.'
}

watch(
  [authLoading, () => authSession.value.authenticated, attachStatus],
  async ([loading, authenticated, callbackStatus]) => {
    if (loading || !authenticated) return

    if (callbackStatus === 'success' && callbackHandled.value !== route.fullPath) {
      callbackHandled.value = route.fullPath
      await Promise.all([initializeAuth(true), loadCharacterRoster(true)])
      return
    }
    if (rosterStatus.value === 'idle' && characters.value.length === 0) {
      await loadCharacterRoster()
    }
  },
  { immediate: true },
)

watch(deleteDialogOpen, async (open) => {
  if (open || !deleteCandidate.value) return
  await nextTick()
  const characterLink = document.querySelector<HTMLAnchorElement>(
    `a[href="/characters/${deleteCandidate.value.characterId}"]`,
  )
  const focusTarget = characterLink ?? document.querySelector<HTMLButtonElement>('.roster-add-card')
  focusTarget?.focus()
})

useHead({ title: 'Character Roster // EVE Space' })
</script>

<template>
  <div class="section-page character-roster-page">
    <header class="page-heading roster-heading">
      <div>
        <p class="ui-eyebrow">CHARACTERS</p>
        <h1>All characters</h1>
      </div>
      <div class="roster-heading-copy">
        <p>Each capsuleer is authorized individually. Right-click a card to set main or delete.</p>
      </div>
    </header>

    <p
      v-if="attachFeedback"
      class="auth-feedback roster-feedback"
      :class="{ 'auth-error': attachFeedbackIsError }"
      :role="attachFeedbackIsError ? 'alert' : 'status'"
    >
      {{ attachFeedback }}
    </p>

    <div v-if="authLoading" class="app-state-panel app-state-panel--compact" aria-live="polite">
      <div class="app-scanner" aria-hidden="true" />
      <p>Verifying account identity...</p>
    </div>
    <section v-else-if="!authSession.authenticated" class="access-locked-panel">
      <span class="access-locked-icon"><AppIcon name="auth" /></span>
      <div>
        <p class="ui-eyebrow">AUTHORIZATION REQUIRED</p>
        <h2>Connect an EVE character</h2>
        <p>Your character roster requires a verified EVE Space session.</p>
      </div>
      <NuxtLink class="ui-action-primary" to="/auth">OPEN IDENTITY GATEWAY</NuxtLink>
    </section>
    <div
      v-else-if="rosterStatus === 'loading' && characters.length === 0"
      class="app-state-panel app-state-panel--compact"
      aria-live="polite"
    >
      <div class="app-scanner" aria-hidden="true" />
      <p>Loading characters...</p>
    </div>
    <div
      v-else-if="rosterStatus === 'error' && characters.length === 0"
      class="app-state-panel app-error-panel app-state-panel--compact"
      role="alert"
    >
      <span class="app-error-code">ERR / ROSTER</span>
      <h2>Roster unavailable</h2>
      <p>{{ rosterMessage }}</p>
      <button class="ui-action-secondary" type="button" @click="loadCharacterRoster(true)">
        RETRY UPLINK
      </button>
    </div>

    <template v-else-if="authSession.authenticated">
      <p v-if="rosterMessage" class="ui-inline-error" role="alert">{{ rosterMessage }}</p>
      <section class="character-roster" aria-label="All characters">
        <UiContextMenu
          v-for="character in characters"
          :key="character.characterId"
          :label="character.name"
          description="CHARACTER ACTIONS"
        >
          <template #trigger>
            <CharacterRosterCard :character="character" @prefetch="prefetchCharacterOverview" />
          </template>

          <UiContextMenuItem
            v-if="!character.isMain"
            :disabled="mainCharacterPending !== undefined || deleteCharacterPending !== undefined"
            @select="selectMainCharacter(character.characterId)"
          >
            {{ mainCharacterPending === character.characterId ? 'Updating…' : 'Set as main' }}
          </UiContextMenuItem>
          <UiContextMenuSeparator v-if="!character.isMain" />
          <UiContextMenuItem
            :disabled="
              character.isMain ||
              mainCharacterPending !== undefined ||
              deleteCharacterPending !== undefined
            "
            tone="danger"
            @select="requestCharacterDeletion(character)"
          >
            <template v-if="character.isMain">Choose another main before deleting</template>
            <template v-else-if="deleteCharacterPending === character.characterId"
              >Deleting…</template
            >
            <template v-else>Delete character</template>
          </UiContextMenuItem>
        </UiContextMenu>
        <CharacterRosterPlaceholder @attach="attachCharacter" />
      </section>
      <UiConfirmDialog
        v-model:open="deleteDialogOpen"
        :title="`Delete ${deleteCandidate?.name ?? 'character'}?`"
        description="This removes the character and its authorization from this EVE Space account. This action cannot be undone."
        confirm-label="Delete character"
        pending-label="Deleting..."
        :pending="deleteCharacterPending === deleteCandidate?.characterId"
        :error="deleteDialogError"
        tone="danger"
        @confirm="confirmCharacterDeletion"
      />
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/pages/character-roster.css');
@import url('~/assets/css/pages/settings.css');
@import url('~/assets/css/responsive/roster.css');
@import url('~/assets/css/responsive/settings.css');
</style>
