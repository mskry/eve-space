<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { platformPageMetadata } from '#build/eve-space-platform/navigation'
import { adminSessionQuery, adminSetupQuery } from '../queries/admin'
import {
  organizationActivitiesQuery,
  organizationComplianceQuery,
  type OrganizationActivities,
} from '../queries/organization'
import { formatOrganizationTimestamp } from '../utils/organization-presentation'

definePageMeta({ title: 'Overview' })

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const { enabledModuleIds } = usePlatformModuleRuntime()
const adminSessionQueryResult = useQuery(() => ({
  ...adminSessionQuery(apiClient),
  enabled: import.meta.client,
}))
const adminSetupQueryResult = useQuery(() => ({
  ...adminSetupQuery(apiClient),
  enabled: import.meta.client,
}))
const complianceQueryResult = useQuery(() => ({
  ...organizationComplianceQuery(apiClient),
  enabled:
    import.meta.client &&
    authSession.value.authenticated &&
    adminSetupQueryResult.data.value?.required === false,
}))
const activityQueryResult = useQuery(() => ({
  ...organizationActivitiesQuery(apiClient),
  enabled:
    import.meta.client &&
    authSession.value.authenticated &&
    (complianceQueryResult.data.value?.state === 'compliant' ||
      complianceQueryResult.data.value?.state === 'review_required'),
}))
const sections = computed(() =>
  visibleDashboardSections(
    adminSessionQueryResult.data.value?.authenticated === true,
    authSession.value.authenticated
      ? authSession.value.account.mainCharacter.characterId
      : undefined,
  ),
)
const compliance = computed(() => complianceQueryResult.data.value)
const activities = computed(() => activityQueryResult.data.value?.activities ?? [])
const impairedActivitySources = computed(
  () =>
    activityQueryResult.data.value?.sources.filter(
      ({ freshness }) => freshness.state !== 'current',
    ) ?? [],
)

function activityCharacters(activity: OrganizationActivities['activities'][number]) {
  const participationByCharacter = new Map(
    activity.participation.map((participation) => [participation.characterId, participation.state]),
  )
  const characterIds = new Set([
    ...activity.eligibleCharacterIds,
    ...activity.participation.map(({ characterId }) => characterId),
  ])
  return [...characterIds].map((characterId) => ({
    characterId,
    characterName:
      compliance.value?.characters.find((character) => character.characterId === characterId)
        ?.characterName ?? `Character ${characterId}`,
    state: participationByCharacter.get(characterId) ?? ('eligible' as const),
  }))
}

function activityKind(kind: string) {
  return kind.replaceAll('-', ' ').toUpperCase()
}

function activityDestination(activity: OrganizationActivities['activities'][number]) {
  const target = activity.linkTarget
  if (!target || !enabledModuleIds.value.has(target.moduleId)) return undefined
  const page = platformPageMetadata.find(
    ({ moduleId, pageId }) => moduleId === target.moduleId && pageId === target.pageId,
  )
  if (!page) return undefined
  const query: Record<string, string> = {}
  if (target.activityId) query.activityId = target.activityId
  if (target.corporationId) query.corporationId = String(target.corporationId)
  if (target.characterId) query.characterId = String(target.characterId)
  return { name: page.pageName, query }
}

function freshnessLabel(state: string) {
  return state.replaceAll('-', ' ').toUpperCase()
}

function participationLabel(state: string) {
  return state.replaceAll('-', ' ').toUpperCase()
}

useHead({
  title: 'Overview // EVE Space',
  meta: [{ name: 'description', content: 'EVE Space operations dashboard.' }],
})
</script>

<template>
  <div class="section-page overview-page">
    <UiStatePanel v-if="authLoading" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Verifying account identity...</p>
    </UiStatePanel>

    <template v-else>
      <header class="page-heading">
        <div>
          <p class="ui-eyebrow">OVERVIEW</p>
          <h1>{{ authSession.authenticated ? 'Member overview' : 'Command overview' }}</h1>
        </div>
        <p v-if="authSession.authenticated">
          Registration standing and prioritized activity across every eligible attached character.
        </p>
        <p v-else>
          One surface for public identity records, authorized ESI data, and future alliance
          services.
        </p>
      </header>

      <template v-if="authSession.authenticated">
        <UiStatePanel
          v-if="
            adminSetupQueryResult.asyncStatus.value === 'loading' &&
            !adminSetupQueryResult.data.value
          "
          compact
          role="status"
        >
          <template #icon><div class="app-scanner" aria-hidden="true" /></template>
          <p>Checking deployment configuration...</p>
        </UiStatePanel>

        <UiStatePanel
          v-else-if="adminSetupQueryResult.status.value === 'error'"
          code="SETUP STATUS UNAVAILABLE"
          title="Deployment configuration could not be checked"
          compact
          role="alert"
        />

        <UiStatePanel
          v-else-if="adminSetupQueryResult.data.value?.required"
          code="DEPLOYMENT SETUP REQUIRED"
          title="Configure the managed organization"
          compact
        >
          <p>
            Organization compliance and member activity become available after deployment setup.
          </p>
          <NuxtLink class="ui-action-secondary" to="/admin/login"> OPEN DEPLOYMENT SETUP </NuxtLink>
        </UiStatePanel>

        <UiStatePanel
          v-else-if="complianceQueryResult.asyncStatus.value === 'loading' && !compliance"
          compact
          role="status"
        >
          <template #icon><div class="app-scanner" aria-hidden="true" /></template>
          <p>Evaluating organization registration...</p>
        </UiStatePanel>

        <UiStatePanel
          v-else-if="complianceQueryResult.status.value === 'error' && !compliance"
          code="COMPLIANCE UNAVAILABLE"
          title="Registration standing could not be loaded"
          compact
          role="alert"
        >
          <p>Try again after the current request completes.</p>
        </UiStatePanel>

        <template v-else-if="compliance">
          <OrganizationComplianceDetails
            :compliance="compliance"
            :api-base="runtimeConfig.public.apiBase"
          />

          <section class="member-activity" aria-labelledby="member-activity-heading">
            <header class="member-activity__heading">
              <div>
                <p class="ui-eyebrow">ORGANIZATION ACTIVITY</p>
                <h2 id="member-activity-heading">Priority queue</h2>
              </div>
              <span v-if="activityQueryResult.data.value"> {{ activities.length }} ACTIVE </span>
            </header>

            <output v-if="impairedActivitySources.length" class="activity-source-notice">
              Some activity providers are delayed or unavailable. Available activity remains
              visible; affected sources:
              {{ impairedActivitySources.map(({ providerId }) => providerId).join(', ') }}.
            </output>

            <UiStatePanel
              v-if="
                activityQueryResult.asyncStatus.value === 'loading' &&
                !activityQueryResult.data.value
              "
              compact
              role="status"
            >
              <template #icon><div class="app-scanner" aria-hidden="true" /></template>
              <p>Loading prioritized organization activity...</p>
            </UiStatePanel>
            <UiStatePanel
              v-else-if="activityQueryResult.status.value === 'error'"
              code="ACTIVITY UNAVAILABLE"
              title="Organization activity could not be loaded"
              compact
              role="alert"
            />
            <UiStatePanel
              v-else-if="compliance.state === 'pending' || compliance.state === 'suspended'"
              code="ACCESS LIMITED"
              title="Registration action required"
              compact
            >
              <p>Protected organization activity is withheld until member access is restored.</p>
            </UiStatePanel>
            <UiStatePanel
              v-else-if="activityQueryResult.data.value && activities.length === 0"
              code="QUEUE CLEAR"
              title="No current organization activity"
              compact
            />
            <div v-else-if="activities.length" class="activity-grid">
              <article
                v-for="activity in activities"
                :key="activity.id"
                class="activity-card"
                :class="{ 'activity-card--actionable': activity.requiredAction }"
              >
                <header>
                  <span>{{ activityKind(activity.kind) }}</span>
                  <span :data-freshness="activity.freshness.state">
                    {{ freshnessLabel(activity.freshness.state) }}
                  </span>
                </header>
                <h3>{{ activity.title }}</h3>
                <p v-if="activity.summary">{{ activity.summary }}</p>
                <dl>
                  <div>
                    <dt>Deadline</dt>
                    <dd>
                      <time v-if="activity.deadline" :datetime="activity.deadline">
                        {{ formatOrganizationTimestamp(activity.deadline) }} UTC
                      </time>
                      <span v-else>Open ended</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Next action</dt>
                    <dd>{{ activity.requiredAction?.label ?? 'Monitor activity' }}</dd>
                  </div>
                </dl>
                <div class="activity-card__characters">
                  <span>CHARACTER ELIGIBILITY</span>
                  <ul v-if="activityCharacters(activity).length">
                    <li
                      v-for="character in activityCharacters(activity)"
                      :key="character.characterId"
                    >
                      <strong>{{ character.characterName }}</strong>
                      <span :data-participation="character.state">
                        {{ participationLabel(character.state) }}
                      </span>
                    </li>
                  </ul>
                  <strong v-else>No character eligibility is currently confirmed</strong>
                </div>
                <NuxtLink
                  v-if="activityDestination(activity)"
                  class="activity-card__link"
                  :to="activityDestination(activity)!"
                >
                  OPEN DETAILS
                </NuxtLink>
              </article>
            </div>
          </section>
        </template>
      </template>

      <section v-else class="overview-hero">
        <div>
          <span class="overview-panel-index">SYSTEM / ONLINE</span>
          <h2>Identity link available</h2>
          <p>
            Public records are available now. Authorize an EVE character when a protected
            integration requires it.
          </p>
        </div>
        <NuxtLink class="ui-action-primary" to="/auth"> AUTHORIZE CHARACTER </NuxtLink>
      </section>

      <section
        v-if="!authSession.authenticated"
        class="section-grid"
        aria-label="Dashboard sections"
      >
        <NuxtLink
          v-for="(section, index) in sections"
          :key="`${section.ownerId}/${section.navigationId}`"
          :to="section.to"
          class="section-card"
        >
          <span class="section-card-icon"><AppIcon :name="section.icon" /></span>
          <span class="section-card-number">0{{ index + 1 }}</span>
          <strong>{{ section.label }}</strong>
          <p>{{ section.description }}</p>
          <small>
            {{
              section.access === 'authorized'
                ? 'EVE SSO REQUIRED'
                : section.access === 'admin'
                  ? 'OWNER ACCESS'
                  : 'PUBLIC ACCESS'
            }}
          </small>
        </NuxtLink>
      </section>

      <section v-if="!authSession.authenticated" class="status-strip">
        <div><span>API</span><strong>HONO / HEALTHY</strong></div>
        <div><span>DATA SOURCE</span><strong>TRANQUILITY / ESI</strong></div>
        <div><span>SESSION</span><strong>ANONYMOUS</strong></div>
        <div><span>CACHE</span><strong>PROCESS LOCAL</strong></div>
      </section>
    </template>
  </div>
</template>
