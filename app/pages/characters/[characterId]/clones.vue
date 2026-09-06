<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { characterSkillsQuery } from '../../../queries/characters'
import {
  canRunCharacterClonesQuery,
  characterClonesQuery,
  characterImplantsQuery,
} from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ title: 'Character Clones', layout: 'headerless' })
useHead({ title: 'Character Clones // EVE Space' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const authenticated = computed(() => authSession.value.authenticated)
const ownsCharacter = computed(() =>
  characters.value.some((character) => character.characterId === characterId.value),
)
const access = computed(() => ({
  isClient: import.meta.client,
  authenticated: authenticated.value,
  ownsCharacter: ownsCharacter.value,
}))

const clonesQuery = useQuery(() =>
  characterClonesQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: access.value,
  }),
)
const implantsQuery = useQuery(() =>
  characterImplantsQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: access.value,
  }),
)
// Jump-clone capacity lives on the skills resource; the record shell already prefetches it, and a
// failure here only leaves the derived maximum unknown.
const skillsQuery = useQuery(() => ({
  ...characterSkillsQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunCharacterClonesQuery(access.value, characterId.value ?? 0),
}))
const clones = clonesQuery.data
const implants = implantsQuery.data
const skills = skillsQuery.data
const cloneState = computed(() =>
  resourceState(clonesQuery.data.value, clonesQuery.error.value, clonesQuery.status.value),
)
const implantState = computed(() =>
  resourceState(implantsQuery.data.value, implantsQuery.error.value, implantsQuery.status.value),
)

useCharacterReauthorization(characterId, () =>
  Promise.all([clonesQuery.refetch(), implantsQuery.refetch()]),
)

function resourceState(data: unknown, error: unknown, status: string): CloneResourceState {
  if (data) return { status: 'ready', message: '', authorizeUrl: '' }
  if (
    error instanceof ApiQueryError &&
    (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
  ) {
    return {
      status: 'authorization',
      message: error.message,
      authorizeUrl: error.authorizeUrl ?? '',
    }
  }
  if (status === 'error') {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'This resource is temporarily unavailable.',
      authorizeUrl: '',
    }
  }
  return { status: 'loading', message: '', authorizeUrl: '' }
}
</script>

<template>
  <section class="character-clones-route" aria-label="Character clones">
    <CharacterClonesWorkspace
      :key="characterId"
      :clones="clones"
      :clone-state="cloneState"
      :implants="implants"
      :implant-state="implantState"
      :skills="skills"
      @retry-clones="clonesQuery.refetch()"
      @retry-implants="implantsQuery.refetch()"
    />
  </section>
</template>

<style>
@import url('~/assets/css/features/clones.css');
@import url('~/assets/css/responsive/clones.css');
</style>
