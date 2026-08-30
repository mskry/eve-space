<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { adminSessionQuery } from '../queries/admin'

definePageMeta({ title: 'Overview' })

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const adminSessionQueryResult = useQuery(() => ({
  ...adminSessionQuery(apiClient),
  enabled: import.meta.client,
}))
const sections = computed(() =>
  visibleDashboardSections(
    adminSessionQueryResult.data.value?.authenticated === true,
    authSession.value.authenticated
      ? authSession.value.account.mainCharacter.characterId
      : undefined,
  ),
)

useHead({
  title: 'Overview // EVE Space',
  meta: [{ name: 'description', content: 'EVE Space operations dashboard.' }],
})
</script>

<template>
  <div class="section-page overview-page">
    <header class="page-heading">
      <div>
        <p class="ui-eyebrow">OVERVIEW</p>
        <h1>Command overview</h1>
      </div>
      <p>
        One surface for public identity records, authorized ESI data, and future alliance services.
      </p>
    </header>

    <section class="overview-hero">
      <div>
        <span class="overview-panel-index">SYSTEM / ONLINE</span>
        <h2>
          {{
            authSession.authenticated
              ? `Welcome, ${authSession.account.mainCharacter.name}`
              : 'Identity link available'
          }}
        </h2>
        <p v-if="authSession.authenticated">
          Your EVE identity is active. Protected integrations can request their required scopes.
        </p>
        <p v-else>
          Public records are available now. Authorize an EVE character when a protected integration
          requires it.
        </p>
      </div>
      <NuxtLink
        v-if="!authLoading && !authSession.authenticated"
        class="ui-action-primary"
        to="/auth"
        >AUTHORIZE CHARACTER</NuxtLink
      >
      <span v-else-if="authLoading" class="overview-system-badge">VERIFYING SESSION</span>
      <span v-else class="overview-system-badge active">IDENTITY VERIFIED</span>
    </section>

    <section class="section-grid" aria-label="Dashboard sections">
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

    <section class="status-strip">
      <div><span>API</span><strong>HONO / HEALTHY</strong></div>
      <div><span>DATA SOURCE</span><strong>TRANQUILITY / ESI</strong></div>
      <div>
        <span>SESSION</span
        ><strong>{{ authSession.authenticated ? 'AUTHORIZED' : 'ANONYMOUS' }}</strong>
      </div>
      <div><span>CACHE</span><strong>PROCESS LOCAL</strong></div>
    </section>
  </div>
</template>
