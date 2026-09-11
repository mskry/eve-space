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
  refetchCharacterRoster,
  selectMainCharacter,
} = useCharacterRoster(apiClient)
const { openConfirmDialog } = useConfirmDialog()
const callbackHandled = ref('')

const attachStatus = computed(() =>
  typeof route.query.attach === 'string' ? route.query.attach : '',
)
const attachFeedback = computed(() => {
  if (attachStatus.value === 'success') return 'Character authorization completed.'
  if (attachStatus.value === 'approval-required') {
    return 'Moving this character requires deployment-administrator approval. Ask for a valid transfer link and open it while signed in to the intended destination account.'
  }
  if (attachStatus.value === 'approval-unusable') {
    return 'This transfer approval can no longer be used. Ask a deployment administrator for a new transfer link.'
  }
  if (attachStatus.value === 'main-character') {
    return 'Sign in to the source account and choose another main character, then return to the intended destination and retry the approval link while valid or request a replacement.'
  }
  if (attachStatus.value === 'authority-evidence') {
    return 'Remove active organization authority through the authorized organization workflow, then retry the approval link while valid or request a replacement.'
  }
  if (attachStatus.value === 'corporation-source') {
    return 'Replace or revoke the active corporation data source through the authorized workflow, then retry the approval link while valid or request a replacement.'
  }
  if (attachStatus.value === 'conflict') {
    return 'The character could not be added. Start a new character authorization and try again.'
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
  globalThis.setTimeout(() => {
    openConfirmDialog({
      confirmLabel: 'Delete character',
      description:
        'This removes the character and its authorization from this EVE Space account. This action cannot be undone.',
      onClose: () => restoreCharacterDeletionFocus(character.characterId),
      onConfirm: () => confirmCharacterDeletion(character),
      pending: () => deleteCharacterPending.value === character.characterId,
      pendingLabel: 'Deleting...',
      title: `Delete ${character.name}?`,
      tone: 'danger',
    })
  })
}

async function confirmCharacterDeletion(character: CharacterRosterEntry) {
  const deleted = await removeCharacter(character.characterId)
  if (!deleted) throw new Error(rosterMessage.value || 'Character could not be deleted.')
  return true
}

async function restoreCharacterDeletionFocus(characterId: number) {
  await nextTick()
  const characterLink = document.querySelector<HTMLAnchorElement>(
    `a[href="/characters/${characterId}"]`,
  )
  const focusTarget = characterLink ?? document.querySelector<HTMLButtonElement>('.roster-add-card')
  focusTarget?.focus()
}

watch(
  [authLoading, () => authSession.value.authenticated, attachStatus],
  async ([loading, authenticated, callbackStatus]) => {
    if (loading || !authenticated) return

    if (callbackStatus === 'success' && callbackHandled.value !== route.fullPath) {
      callbackHandled.value = route.fullPath
      await Promise.allSettled([initializeAuth(true), refetchCharacterRoster()])
      return
    }
    if (rosterStatus.value === 'idle' && characters.value.length === 0) {
      await loadCharacterRoster()
    }
  },
  { immediate: true },
)

useHead({ title: 'Characters // EVE Space' })
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

    <UiStatePanel v-if="authLoading" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Verifying account identity...</p>
    </UiStatePanel>
    <section v-else-if="!authSession.authenticated" class="access-locked-panel">
      <span class="access-locked-icon"><AppIcon name="auth" /></span>
      <div>
        <p class="ui-eyebrow">AUTHORIZATION REQUIRED</p>
        <h2>Connect an EVE character</h2>
        <p>Your authorized characters require a verified EVE Space session.</p>
      </div>
      <NuxtLink class="ui-action-primary" to="/auth">OPEN IDENTITY GATEWAY</NuxtLink>
    </section>
    <UiStatePanel
      v-else-if="rosterStatus === 'loading' && characters.length === 0"
      compact
      role="status"
    >
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Loading characters...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="rosterStatus === 'error' && characters.length === 0"
      code="ERR / CHARACTERS"
      title="Characters unavailable"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ rosterMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="refetchCharacterRoster()">
          RETRY UPLINK
        </button>
      </template>
    </UiStatePanel>

    <template v-else-if="authSession.authenticated">
      <p v-if="rosterMessage" class="ui-inline-error" role="alert">{{ rosterMessage }}</p>
      <section class="character-roster" aria-label="All characters">
        <UiContextMenu
          v-for="character in characters"
          :key="character.characterId"
          :accessible-label="`Character actions for ${character.name}`"
          label="Character actions"
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
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/pages/character-roster.css');
@import url('~/assets/css/features/character-access.css');
@import url('~/assets/css/responsive/roster.css');
</style>
