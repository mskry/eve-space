<script setup lang="ts">
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { adminSessionQuery } from '../../queries/admin'
import { ADMIN_QUERY_KEYS } from '../../queries/query-keys'
import { toApiQueryError } from '../../utils/query-error'

definePageMeta({ title: 'Administration' })

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const sessionQuery = useQuery(() => ({
  ...adminSessionQuery(apiClient),
  enabled: import.meta.client,
}))
const adminSession = sessionQuery.data
const organizationType = ref<'corporation' | 'alliance'>('corporation')
const organizationId = ref('')
const feedback = ref('')

const organizationMutation = useMutation({
  mutation: async () => {
    const response = await apiClient.api.admin.organization.$put({
      json: {
        organizationType: organizationType.value,
        organizationId: organizationId.value,
      },
    })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'Organization could not be updated.')
    return response.json()
  },
  onSuccess: ({ organization }) => {
    const current = adminSession.value
    if (current?.authenticated) {
      queryCache.setQueryData(ADMIN_QUERY_KEYS.session, {
        ...current,
        account: { ...current.account, organization },
      })
    }
    feedback.value = 'Deployment organization updated.'
  },
})

const logoutMutation = useMutation({
  mutation: async () => {
    const response = await apiClient.api.admin.logout.$post()
    if (!response.ok) throw await toApiQueryError(response, 'Administrator logout failed.')
  },
  onSuccess: async () => {
    queryCache.setQueryData(ADMIN_QUERY_KEYS.session, { authenticated: false })
    await navigateTo('/admin/login')
  },
})

const errorMessage = computed(() =>
  organizationMutation.error.value instanceof Error ? organizationMutation.error.value.message : '',
)
const submitting = computed(() => organizationMutation.asyncStatus.value === 'loading')

watch(
  () => adminSession.value,
  (session) => {
    if (session?.authenticated) {
      organizationType.value = session.account.organization.type
      organizationId.value = String(session.account.organization.id)
    } else if (session && import.meta.client) {
      void navigateTo('/admin/login')
    }
  },
  { immediate: true },
)

useHead({ title: 'Administration // EVE Space' })
</script>

<template>
  <div class="section-page admin-page">
    <header class="page-heading">
      <div>
        <p class="ui-eyebrow">DEPLOYMENT ADMINISTRATION</p>
        <h1>Owner controls</h1>
      </div>
      <p>Configure the EVE organization that owns this deployment and anchors character access.</p>
    </header>

    <div
      v-if="!adminSession?.authenticated"
      class="app-state-panel app-state-panel--compact"
      aria-live="polite"
    >
      <div class="app-scanner" aria-hidden="true" />
      <p>Verifying deployment owner session...</p>
    </div>

    <template v-else>
      <p v-if="feedback" class="auth-feedback" role="status">{{ feedback }}</p>
      <section class="admin-panel">
        <div class="admin-panel-heading">
          <span>OWNER</span>
          <div>
            <p class="ui-eyebrow">LOCAL ADMINISTRATOR</p>
            <h2>{{ adminSession.account.email }}</h2>
          </div>
          <button class="ui-action-secondary" type="button" @click="logoutMutation.mutate()">
            SIGN OUT
          </button>
        </div>
      </section>

      <form class="admin-panel admin-form" @submit.prevent="organizationMutation.mutate()">
        <div class="admin-organization-current">
          <UiEveImage
            :kind="adminSession.account.organization.type"
            :id="adminSession.account.organization.id"
            :dimension="64"
            alt=""
          />
          <div>
            <p class="ui-eyebrow">DEPLOYMENT OWNER</p>
            <h2>{{ adminSession.account.organization.name }}</h2>
            <span>
              [{{ adminSession.account.organization.ticker }}] /
              {{ adminSession.account.organization.type.toUpperCase() }}
            </span>
          </div>
        </div>
        <label
          >Organization type
          <select v-model="organizationType">
            <option value="corporation">Corporation</option>
            <option value="alliance">Alliance</option>
          </select>
        </label>
        <label
          >EVE organization ID<input
            v-model="organizationId"
            type="number"
            min="1"
            inputmode="numeric"
            required
        /></label>
        <p v-if="errorMessage" class="ui-inline-error" role="alert">{{ errorMessage }}</p>
        <button class="ui-action-primary" type="submit" :disabled="submitting">
          {{ submitting ? 'VERIFYING...' : 'UPDATE ORGANIZATION' }}
        </button>
      </form>
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/pages/admin.css');
@import url('~/assets/css/responsive/admin.css');
</style>
