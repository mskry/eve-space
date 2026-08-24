<script setup lang="ts">
import { useQueryCache } from '@pinia/colada'
import { characterOverviewQuery, type CharacterRosterEntry } from '../../queries/characters'
import { prefetchProtectedQuery } from '../../queries/query-cache'

definePageMeta({ title: 'Characters', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const { allianceLogo, characterPortrait, corporationLogo, factionLogo } = useEveImages()
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

function rosterLocationLabel(location: (typeof characters.value)[number]['location']) {
  if (!location) return '--'
  if (location.stationName) return location.stationName
  if (location.structureId) return `${location.solarSystemName} // Private structure`
  return `${location.solarSystemName} // In space`
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
            <article class="roster-card">
              <img
                v-if="character.raceFactionId"
                class="roster-race-mark"
                :src="factionLogo(character.raceFactionId, 256)"
                alt=""
                aria-hidden="true"
              />
              <NuxtLink
                class="roster-card-link"
                :to="`/characters/${character.characterId}`"
                :aria-label="
                  character.isMain
                    ? `View ${character.name}, main character`
                    : `View ${character.name}`
                "
                @pointerenter="prefetchCharacterOverview(character.characterId)"
                @focus="prefetchCharacterOverview(character.characterId)"
              >
                <span class="roster-portrait">
                  <img
                    :src="characterPortrait(character.characterId, 128)"
                    :srcset="`${characterPortrait(character.characterId, 128)} 1x, ${characterPortrait(character.characterId, 256)} 2x`"
                    :alt="`${character.name} character portrait`"
                    width="84"
                    height="84"
                  />
                </span>
                <span class="roster-identity">
                  <span class="roster-identity-name">
                    <h2>{{ character.name }}</h2>
                    <UiMainCharacterMark v-if="character.isMain" variant="icon" />
                  </span>
                  <span class="roster-org">
                    <UiTooltip :content="character.corporation.name" :arrow="false">
                      <img
                        :src="corporationLogo(character.corporation.id, 128)"
                        :alt="`${character.corporation.name} corporation logo`"
                        width="34"
                        height="34"
                      />
                    </UiTooltip>
                    <UiTooltip
                      v-if="character.alliance"
                      :content="character.alliance.name"
                      :arrow="false"
                    >
                      <img
                        :src="allianceLogo(character.alliance.id, 128)"
                        :alt="`${character.alliance.name} alliance logo`"
                        width="34"
                        height="34"
                      />
                    </UiTooltip>
                  </span>
                </span>
              </NuxtLink>
              <div class="roster-stats">
                <span v-if="typeof character.securityStatus === 'number'" class="roster-stat">
                  <SecurityStatus :value="character.securityStatus" />
                </span>
                <span class="roster-stat">
                  <span class="sr-only">Location:</span>
                  <span class="roster-location-icon" aria-hidden="true">
                    <AppIcon name="location" />
                  </span>
                  <span class="roster-stat-value" :title="rosterLocationLabel(character.location)">
                    {{ rosterLocationLabel(character.location) }}
                  </span>
                </span>
                <span class="roster-stat">
                  <span class="sr-only">Ship:</span>
                  <span class="roster-ship-icon" aria-hidden="true">
                    <AppIcon name="ship" />
                  </span>
                  <span
                    class="roster-stat-value"
                    :title="character.ship ? character.ship.name : undefined"
                  >
                    {{ character.ship?.typeName ?? '--' }}
                  </span>
                </span>
                <span class="roster-value-stats">
                  <span class="roster-stat">
                    <span class="roster-stat-key">SP</span>
                    {{
                      typeof character.totalSp === 'number'
                        ? formatCompactAmount(character.totalSp)
                        : '--'
                    }}
                  </span>
                  <span class="roster-value-separator" aria-hidden="true">•</span>
                  <span class="roster-stat">
                    <span class="roster-stat-key">ISK</span>
                    {{
                      typeof character.walletBalance === 'number'
                        ? formatCompactAmount(character.walletBalance)
                        : '--'
                    }}
                  </span>
                </span>
              </div>
            </article>
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
        <button class="roster-card roster-add-card" type="button" @click="attachCharacter">
          <span class="roster-ghost-top" aria-hidden="true">
            <span class="roster-ghost-portrait" />
            <span class="roster-ghost-identity">
              <span class="roster-ghost-line roster-ghost-line--name" />
              <span class="roster-ghost-org">
                <span class="roster-ghost-badge" />
              </span>
            </span>
          </span>
          <span class="roster-ghost-stats" aria-hidden="true">
            <span class="roster-ghost-line roster-ghost-line--stat-short" />
            <span class="roster-ghost-line roster-ghost-line--stat" />
            <span class="roster-ghost-line roster-ghost-line--stat-mid" />
            <span class="roster-ghost-value-stats">
              <span class="roster-ghost-line" />
              <span class="roster-ghost-separator">•</span>
              <span class="roster-ghost-line" />
            </span>
          </span>
          <span class="roster-add-overlay">
            <span class="add-character-icon" aria-hidden="true">+</span>
            ADD CHARACTER
          </span>
        </button>
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
