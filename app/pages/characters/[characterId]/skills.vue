<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import {
  characterAttributesQuery,
  characterSkillQueueQuery,
  characterSkillsQuery,
} from '../../../queries/characters'
import { canRunProtectedCharacterQuery } from '../../../queries/protected-character-query-access'
import { PRIVATE_QUERY_KEYS } from '../../../queries/query-keys'
import type { EsiResourceState } from '../../../types/esi-resource'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ title: 'Character Skills', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const ownsCharacter = useCharacterOwnership(characterId, characters)
const protectedQueryAccess = computed(() => ({
  authenticated: authSession.value.authenticated,
  authenticationReady: !authLoading.value,
  isClient: import.meta.client,
  ownsCharacter: ownsCharacter.value,
}))
const protectedQueryEnabled = computed(() =>
  canRunProtectedCharacterQuery(protectedQueryAccess.value, characterId.value ?? 0),
)

const skillsQuery = useQuery(() => ({
  ...characterSkillsQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: protectedQueryEnabled.value,
}))
const attributesQuery = useQuery(() => ({
  ...characterAttributesQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: protectedQueryEnabled.value,
}))
const skillQueueQuery = useQuery(() => ({
  ...characterSkillQueueQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: protectedQueryEnabled.value,
}))
const skillsPersistencePresentation = useQueryPersistencePresentation(() =>
  PRIVATE_QUERY_KEYS.characterSkills(characterId.value ?? 0),
)
const attributesPersistencePresentation = useQueryPersistencePresentation(() =>
  PRIVATE_QUERY_KEYS.characterAttributes(characterId.value ?? 0),
)
const skillQueuePersistencePresentation = useQueryPersistencePresentation(() =>
  PRIVATE_QUERY_KEYS.characterSkillQueue(characterId.value ?? 0),
)
const skills = skillsQuery.data
const attributes = attributesQuery.data
const skillQueue = skillQueueQuery.data

const skillsMessage = computed(() => queryMessage(skillsQuery.error.value))
const skillsAuthorizeUrl = computed(() => queryAuthorizeUrl(skillsQuery.error.value))
const skillsStatus = computed(() => {
  if (skillsQuery.data.value) return 'idle'
  const error = skillsQuery.error.value
  if (error instanceof ApiQueryError && error.status === 404) return 'not-found'
  return queryStatus(skillsQuery)
})
const attributesStatus = computed(() => queryStatus(attributesQuery))
const skillQueueStatus = computed(() => queryStatus(skillQueueQuery))
const attributesMessage = computed(() => queryMessage(attributesQuery.error.value))
const skillQueueMessage = computed(() => queryMessage(skillQueueQuery.error.value))
const attributesAuthorizeUrl = computed(() => queryAuthorizeUrl(attributesQuery.error.value))
const skillQueueAuthorizeUrl = computed(() => queryAuthorizeUrl(skillQueueQuery.error.value))
const skillsResourceState = computed<EsiResourceState>(() => {
  if (skillsStatus.value === 'loading') {
    return {
      status: 'loading',
      title: '',
      message: 'Decrypting trained skill archive...',
    }
  }
  if (skillsStatus.value === 'scope-required') {
    return {
      status: 'authorization-required',
      code: 'ESI 403 / SKILLS',
      title: 'Skills authorization required',
      message: skillsMessage.value,
      action: skillsAuthorizeUrl.value
        ? { href: skillsAuthorizeUrl.value, label: 'AUTHORIZE THIS CHARACTER' }
        : null,
    }
  }
  if (skillsStatus.value === 'error' || skillsStatus.value === 'not-found') {
    return {
      status: 'error',
      code: skillsStatus.value === 'not-found' ? '404' : 'ERR / SKILLS',
      title: 'Skill archive unavailable',
      message: skillsMessage.value,
      retryLabel: 'RETRY UPLINK',
    }
  }
  return { status: 'ready' }
})

function loadCharacterSkills(force = false) {
  return force ? skillsQuery.refetch() : skillsQuery.refresh()
}

useCharacterReauthorization(characterId, () => {
  void Promise.all([skillsQuery.refetch(), attributesQuery.refetch(), skillQueueQuery.refetch()])
})

function queryStatus(query: typeof skillsQuery | typeof attributesQuery | typeof skillQueueQuery) {
  if (query.data.value) return 'idle'
  const error = query.error.value
  if (
    error instanceof ApiQueryError &&
    (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
  ) {
    return 'scope-required'
  }
  if (query.status.value === 'error') return 'error'
  if (query.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
}

function queryMessage(error: unknown) {
  return error instanceof Error ? error.message : ''
}

function queryAuthorizeUrl(error: unknown) {
  return error instanceof ApiQueryError ? (error.authorizeUrl ?? '') : ''
}
</script>

<template>
  <section class="character-skills-route">
    <EsiResourceBoundary
      :state="skillsResourceState"
      :has-data="Boolean(skills)"
      :presentation="skillsPersistencePresentation"
      @retry="loadCharacterSkills(true)"
    >
      <div v-if="skills" class="skills-layout">
        <section class="skills-catalogue" aria-label="Skill catalogue">
          <CharacterSkillsSummaryCard
            :skills="skills"
            :attributes="attributes"
            :attributes-status="attributesStatus"
            :attributes-message="attributesMessage"
            :attributes-authorize-url="attributesAuthorizeUrl"
            :attributes-presentation="attributesPersistencePresentation"
            @retry-attributes="attributesQuery.refetch()"
          />
          <CharacterSkillsCatalogue
            :key="characterId"
            :skills="skills"
            :skill-queue="skillQueue"
            :skill-queue-status="skillQueueStatus"
          />
        </section>

        <CharacterSkillsQueue
          :skill-queue="skillQueue"
          :status="skillQueueStatus"
          :message="skillQueueMessage"
          :presentation="skillQueuePersistencePresentation"
          :authorize-url="skillQueueAuthorizeUrl"
          :unallocated-sp="skills.unallocatedSp"
          @retry="skillQueueQuery.refetch()"
        />
      </div>
    </EsiResourceBoundary>
  </section>
</template>

<style>
@import url('~/assets/css/features/skills.css');
@import url('~/assets/css/responsive/skills.css');
</style>
