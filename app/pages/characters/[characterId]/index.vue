<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import CharacterOverviewBioCard from '../../../components/character/CharacterOverviewBioCard.vue'
import CharacterOverviewDetails from '../../../components/character/CharacterOverviewDetails.vue'
import { characterOverviewQuery } from '../../../queries/characters'
import { canRunProtectedCharacterQuery } from '../../../queries/protected-character-query-access'
import { PRIVATE_QUERY_KEYS } from '../../../queries/query-keys'
import type { EsiResourceState } from '../../../types/esi-resource'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ layout: 'headerless', title: 'Character Overview' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const ownsCharacter = useCharacterOwnership(characterId, characters)
const access = computed(() => ({
  authenticated: authSession.value.authenticated,
  authenticationReady: !authLoading.value,
  isClient: import.meta.client,
  ownsCharacter: ownsCharacter.value,
}))
const overviewQuery = useQuery(() => ({
  ...characterOverviewQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedCharacterQuery(access.value, characterId.value ?? 0),
}))
const overviewPersistencePresentation = useQueryPersistencePresentation(() =>
  PRIVATE_QUERY_KEYS.characterOverview(characterId.value ?? 0),
)
const overview = overviewQuery.data
const overviewMessage = computed(() =>
  overviewQuery.error.value instanceof Error ? overviewQuery.error.value.message : '',
)
const overviewStatus = computed(() => {
  if (overviewQuery.data.value) {
    return 'idle'
  }
  if (
    overviewQuery.error.value instanceof ApiQueryError &&
    overviewQuery.error.value.status === 404
  ) {
    return 'not-found'
  }
  if (overviewQuery.status.value === 'error') {
    return 'error'
  }
  if (overviewQuery.asyncStatus.value === 'loading') {
    return 'loading'
  }
  return 'idle'
})

function loadCharacterOverview(force = false) {
  return force ? overviewQuery.refetch() : overviewQuery.refresh()
}

useCharacterReauthorization(characterId, () => void overviewQuery.refetch())

const character = computed(() => overview.value?.profile)
const location = computed(() => overview.value?.location)
const ship = computed(() => overview.value?.ship)
const skills = computed(() => overview.value?.skills)

const locationLabel = computed(() => {
  if (location.value?.status !== 'ok') {
    return '—'
  }
  const { data } = location.value
  if (data.stationName) {
    return data.stationName
  }
  if (data.structureId) {
    return `${data.solarSystemName} // Private structure`
  }
  return `${data.solarSystemName} // In space`
})
const shipLabel = computed(() => (ship.value?.status === 'ok' ? ship.value.data.typeName : '—'))
const shipNameLabel = computed(() => (ship.value?.status === 'ok' ? ship.value.data.name : ''))
const skillPointsLabel = computed(() =>
  skills.value?.status === 'ok' ? skills.value.data.totalSp.toLocaleString('en-US') : '—',
)
const pendingAuthorization = computed(() =>
  [location.value, ship.value, skills.value].find(
    (section) => section?.status === 'scope-required',
  ),
)
const overviewResourceState = computed<EsiResourceState>(() => {
  if (overviewStatus.value === 'loading') {
    return {
      message: 'Establishing character-specific ESI uplink...',
      status: 'loading',
      title: '',
    }
  }
  if (overviewStatus.value === 'error' || overviewStatus.value === 'not-found') {
    return {
      code: overviewStatus.value === 'not-found' ? '404' : 'ERR / ESI',
      message: overviewMessage.value,
      retryLabel: 'RETRY UPLINK',
      status: 'error',
      title: 'Record unavailable',
    }
  }
  return { status: 'ready' }
})
const sectionAuthorizationState = computed<EsiResourceState>(() => {
  const authorization = pendingAuthorization.value
  if (!authorization || authorization.status !== 'scope-required') {
    return { status: 'ready' }
  }
  return {
    action: authorization.authorizeUrl
      ? { href: authorization.authorizeUrl, label: 'AUTHORIZE ACCESS' }
      : null,
    code: 'ESI 403 / CHARACTER',
    message: authorization.message,
    status: 'authorization-required',
    title: 'Character authorization required',
  }
})
</script>

<template>
  <div class="character-overview-route">
    <EsiResourceBoundary
      :state="overviewResourceState"
      :has-data="Boolean(character)"
      :compact="false"
      :presentation="overviewPersistencePresentation"
      @retry="loadCharacterOverview(true)"
    >
      <article v-if="character" class="dossier">
        <div class="identity-panel">
          <div class="character-record-grid">
            <section
              class="overview-summary-grid character-overview-record-grid"
              aria-label="Character biography, operations, identity, and progression"
            >
              <div
                class="character-overview-primary-column character-overview-primary-column--with-details"
              >
                <CharacterOverviewBioCard :bio="character.bio" />
                <section
                  class="character-detail-groups character-detail-groups--operations-only"
                  aria-label="Character operations"
                >
                  <section class="character-detail-group character-detail-group--operations">
                    <h2>OPERATIONS</h2>
                    <dl>
                      <div class="character-detail-wide">
                        <dt>LOCATION</dt>
                        <dd class="character-location-detail" :title="locationLabel">
                          <SystemSecurityStatus
                            v-if="
                              location?.status === 'ok' &&
                              typeof location.data.solarSystemSecurityStatus === 'number'
                            "
                            :value="location.data.solarSystemSecurityStatus"
                          />
                          <span>{{ locationLabel }}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>CURRENT SHIP</dt>
                        <dd class="character-ship-detail" :title="shipNameLabel">
                          <UiEveImage
                            v-if="ship?.status === 'ok'"
                            kind="type-icon"
                            :id="ship.data.typeId"
                            :dimension="40"
                            :width="40"
                            :height="40"
                            loading="lazy"
                            decoding="async"
                            alt=""
                          />
                          <span>{{ shipLabel }}</span>
                        </dd>
                      </div>
                    </dl>
                  </section>
                </section>
              </div>
              <CharacterOverviewDetails
                :profile="character"
                :skill-points-label="skillPointsLabel"
              />
            </section>
          </div>

          <EsiResourceBoundary :state="sectionAuthorizationState" />
        </div>
      </article>
    </EsiResourceBoundary>
  </div>
</template>

<style>
@import url('~/assets/css/features/record-dossier.css');
</style>
