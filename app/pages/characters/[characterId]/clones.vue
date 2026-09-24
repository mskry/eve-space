<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { characterSkillsQuery } from '../../../queries/characters'
import { characterClonesQuery, characterImplantsQuery } from '../../../queries/clones'
import { canRunProtectedCharacterQuery } from '../../../queries/protected-character-query-access'
import { PRIVATE_QUERY_KEYS } from '../../../queries/query-keys'
import type { CloneResourceState } from '../../../types/clones'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ layout: 'headerless', title: 'Character Clones' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const authenticated = computed(() => authSession.value.authenticated)
const authenticationReady = computed(() => !authLoading.value)
const ownsCharacter = useCharacterOwnership(characterId, characters)
const access = computed(() => ({
  authenticated: authenticated.value,
  authenticationReady: authenticationReady.value,
  isClient: import.meta.client,
  ownsCharacter: ownsCharacter.value,
}))

const clonesQuery = useQuery(() =>
  characterClonesQuery({
    access: access.value,
    apiClient,
    characterId: characterId.value ?? 0,
  }),
)
const implantsQuery = useQuery(() =>
  characterImplantsQuery({
    access: access.value,
    apiClient,
    characterId: characterId.value ?? 0,
  }),
)
// Jump-clone capacity lives on the skills resource; the record shell already prefetches it, and a
// failure here only leaves the derived maximum unknown.
const skillsQuery = useQuery(() => ({
  ...characterSkillsQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedCharacterQuery(access.value, characterId.value ?? 0),
}))
const clones = clonesQuery.data
const implants = implantsQuery.data
const skills = skillsQuery.data
const clonesPersistencePresentation = useQueryPersistencePresentation(() =>
  PRIVATE_QUERY_KEYS.characterClones(characterId.value ?? 0),
)
const implantsPersistencePresentation = useQueryPersistencePresentation(() =>
  PRIVATE_QUERY_KEYS.characterImplants(characterId.value ?? 0),
)
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
  if (data) {
    return { authorizeUrl: '', message: '', status: 'ready' }
  }
  if (
    error instanceof ApiQueryError &&
    (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
  ) {
    return {
      authorizeUrl: error.authorizeUrl ?? '',
      message: error.message,
      status: 'authorization',
    }
  }
  if (status === 'error') {
    return {
      authorizeUrl: '',
      message: error instanceof Error ? error.message : 'This resource is temporarily unavailable.',
      status: 'error',
    }
  }
  return { authorizeUrl: '', message: '', status: 'loading' }
}
</script>

<template>
  <section class="character-clones-route" aria-label="Character clones">
    <CharacterClonesWorkspace
      :key="characterId"
      :clones="clones"
      :clone-state="cloneState"
      :clones-presentation="clonesPersistencePresentation"
      :implants="implants"
      :implant-state="implantState"
      :implants-presentation="implantsPersistencePresentation"
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
