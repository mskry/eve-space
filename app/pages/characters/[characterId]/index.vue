<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { characterOverviewQuery } from '../../../queries/characters'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import { ApiQueryError } from '../../../utils/query-error'

definePageMeta({ title: 'Character Overview', layout: 'headerless' })

const route = useRoute()
const { factionLogo, typeImage } = useEveImages()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const characterId = computed(() => {
  const value = Array.isArray(route.params.characterId)
    ? route.params.characterId[0]
    : route.params.characterId
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
})
const overviewQuery = useQuery(() => ({
  ...characterOverviewQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const overview = overviewQuery.data
const bioCard = ref<HTMLElement>()
const bioCopy = ref<HTMLElement>()
const operationsGroup = ref<HTMLElement>()
const bioExpandedHeight = ref(0)
const bioIsOverflowing = ref(false)
const overviewMessage = computed(() =>
  overviewQuery.error.value instanceof Error ? overviewQuery.error.value.message : '',
)
const overviewStatus = computed(() => {
  if (overviewQuery.data.value) return 'idle'
  if (
    overviewQuery.error.value instanceof ApiQueryError &&
    overviewQuery.error.value.status === 404
  ) {
    return 'not-found'
  }
  if (overviewQuery.status.value === 'error') return 'error'
  if (overviewQuery.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})

function loadCharacterOverview(force = false) {
  return force ? overviewQuery.refetch() : overviewQuery.refresh()
}

watch(
  [characterId, () => route.query.reauthorize],
  ([id, reauthorize]) => {
    if (id && reauthorize === 'success') void overviewQuery.refetch()
  },
  { immediate: true },
)

const character = computed(() => overview.value?.profile)
const location = computed(() => overview.value?.location)
const ship = computed(() => overview.value?.ship)
const skills = computed(() => overview.value?.skills)

const locationLabel = computed(() => {
  if (location.value?.status !== 'ok') return '—'
  const { data } = location.value
  if (data.stationName) return data.stationName
  if (data.structureId) return `${data.solarSystemName} // Private structure`
  return `${data.solarSystemName} // In space`
})
const systemLabel = computed(() =>
  location.value?.status === 'ok' ? location.value.data.solarSystemName : '—',
)
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
const formattedBirthday = computed(() =>
  character.value ? formatBirthday(character.value.birthday) : '',
)
const genderSymbol = computed(() => {
  const gender = character.value?.gender.toLowerCase()
  if (gender === 'female') return '♀'
  if (gender === 'male') return '♂'
  return '—'
})

function measureBioExpansion() {
  bioExpandedHeight.value =
    (bioCard.value?.offsetHeight ?? 0) + (operationsGroup.value?.offsetHeight ?? 0)
  bioIsOverflowing.value = (bioCopy.value?.scrollHeight ?? 0) > (bioCopy.value?.clientHeight ?? 0)
}

watch(character, async () => {
  await nextTick()
  measureBioExpansion()
})

onMounted(() => {
  window.addEventListener('resize', measureBioExpansion)
  measureBioExpansion()
})

onBeforeUnmount(() => window.removeEventListener('resize', measureBioExpansion))
</script>

<template>
  <div class="character-overview-route">
    <div
      v-if="overviewStatus === 'loading' && !character"
      class="app-state-panel"
      aria-live="polite"
    >
      <div class="app-scanner" aria-hidden="true" />
      <p>Establishing character-specific ESI uplink...</p>
    </div>
    <div
      v-else-if="overviewStatus === 'error' || overviewStatus === 'not-found'"
      class="app-state-panel app-error-panel"
      role="alert"
    >
      <span class="app-error-code">{{ overviewStatus === 'not-found' ? '404' : 'ERR / ESI' }}</span>
      <h2>Record unavailable</h2>
      <p>{{ overviewMessage }}</p>
      <button class="ui-action-secondary" type="button" @click="loadCharacterOverview(true)">
        RETRY UPLINK
      </button>
    </div>

    <article v-else-if="character" class="dossier">
      <div class="identity-panel">
        <div
          class="character-record-grid"
          :style="{ '--bio-expanded-height': `${bioExpandedHeight}px` }"
        >
          <section
            class="overview-summary-grid"
            :class="{ 'overview-summary-grid--single-affiliation': !character.alliance }"
            aria-label="Character biography and affiliations"
          >
            <div
              ref="bioCard"
              class="overview-bio-card"
              :class="{ 'overview-bio-card--expandable': bioIsOverflowing }"
            >
              <span class="card-index">01</span>
              <p>BIO</p>
              <div ref="bioCopy" class="overview-bio-copy">
                {{ character.bio || 'No biography recorded.' }}
              </div>
            </div>
            <section class="affiliation-card">
              <span class="card-index">02</span>
              <p>CORPORATION</p>
              <h2>
                <span class="affiliation-ticker">[{{ character.corporation.ticker }}]</span>
                {{ character.corporation.name }}
              </h2>
              <div>
                <span>{{ character.corporation.memberCount.toLocaleString('en-US') }} MEMBERS</span>
              </div>
            </section>
            <section v-if="character.alliance" class="affiliation-card">
              <span class="card-index">03</span>
              <p>ALLIANCE</p>
              <h2>
                <span class="affiliation-ticker">[{{ character.alliance.ticker }}]</span>
                {{ character.alliance.name }}
              </h2>
              <div>
                <span>ACTIVE AFFILIATION</span>
              </div>
            </section>
          </section>
          <section class="character-detail-groups" aria-label="Character details">
            <section
              ref="operationsGroup"
              class="character-detail-group character-detail-group--operations"
            >
              <h2>OPERATIONS</h2>
              <dl>
                <div>
                  <dt>CURRENT SYSTEM</dt>
                  <dd>{{ systemLabel }}</dd>
                </div>
                <div>
                  <dt>DOCKED AT</dt>
                  <dd :title="locationLabel">{{ locationLabel }}</dd>
                </div>
                <div>
                  <dt>CURRENT SHIP</dt>
                  <dd class="character-ship-detail" :title="shipNameLabel">
                    <img
                      v-if="ship?.status === 'ok'"
                      :src="typeImage(ship.data.typeId, 'icon', 64)"
                      alt=""
                      width="40"
                      height="40"
                    />
                    <span>{{ shipLabel }}</span>
                  </dd>
                </div>
              </dl>
            </section>
            <section class="character-detail-group character-detail-group--identity">
              <h2>IDENTITY</h2>
              <dl>
                <div
                  :class="
                    character.factionId
                      ? 'character-detail-col-start'
                      : 'character-detail-wide character-detail-col-start'
                  "
                >
                  <dt>SECURITY STATUS</dt>
                  <dd><SecurityStatus :value="character.securityStatus" /></dd>
                </div>
                <div v-if="character.factionId" class="character-detail-col-end">
                  <dt>FACTION</dt>
                  <dd>
                    <img
                      class="militia-mark"
                      :src="factionLogo(character.factionId, 64)"
                      alt="Faction militia emblem"
                      width="32"
                      height="32"
                    />
                  </dd>
                </div>
                <div class="character-detail-col-start">
                  <dt>RACE</dt>
                  <dd>{{ character.race }}</dd>
                </div>
                <div class="character-detail-col-end">
                  <dt>BLOODLINE</dt>
                  <dd>{{ character.bloodline }}</dd>
                </div>
                <div class="character-detail-col-start">
                  <dt>DATE OF BIRTH</dt>
                  <dd>{{ formattedBirthday }}</dd>
                </div>
                <div class="character-detail-col-end">
                  <dt>GENDER</dt>
                  <dd>
                    <span class="gender-symbol" :title="character.gender" aria-hidden="true">
                      {{ genderSymbol }}
                    </span>
                    <span class="sr-only">{{ character.gender }}</span>
                  </dd>
                </div>
                <div v-if="character.corporationTitle" class="character-detail-wide">
                  <dt>CORPORATION TITLE</dt>
                  <dd>{{ character.corporationTitle }}</dd>
                </div>
              </dl>
            </section>
            <section class="character-detail-group character-detail-group--progression">
              <h2>PROGRESSION</h2>
              <dl>
                <div class="character-detail-primary">
                  <dt>TOTAL SKILL POINTS</dt>
                  <dd>{{ skillPointsLabel }}</dd>
                </div>
                <div>
                  <dt>ACHIEVEMENT SCORE</dt>
                  <dd>{{ character.achievementScore }}</dd>
                </div>
              </dl>
            </section>
          </section>
        </div>

        <p v-if="pendingAuthorization" class="wallet-state wallet-authorize">
          <span>{{ pendingAuthorization.message }}</span>
          <a :href="pendingAuthorization.authorizeUrl">AUTHORIZE ACCESS</a>
        </p>

        <footer class="record-footer">
          <a
            :href="`https://evewho.com/character/${character.id}`"
            target="_blank"
            rel="noreferrer"
          >
            EXTERNAL RECORD ↗
          </a>
        </footer>
      </div>
    </article>
  </div>
</template>

<style>
@import url('~/assets/css/features/record-dossier.css');
@import url('~/assets/css/responsive/record.css');
</style>
