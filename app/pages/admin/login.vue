<script setup lang="ts">
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { adminSessionQuery, adminSetupQuery } from '../../queries/admin'
import { ADMIN_QUERY_KEYS } from '../../queries/query-keys'
import type { AdminLoginPayload, AdminSetupPayload } from '../../types/admin'
import { toApiQueryError } from '../../utils/query-error'

definePageMeta({ layout: 'auth', title: 'Administrator Login' })

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const setupQuery = useQuery(() => ({
  ...adminSetupQuery(apiClient),
  enabled: import.meta.client,
}))
const sessionQuery = useQuery(() => ({
  ...adminSessionQuery(apiClient),
  enabled: import.meta.client,
}))
const setup = setupQuery.data

const setupMutation = useMutation({
  mutation: async (payload: AdminSetupPayload) => {
    const response = await apiClient.api.admin.setup.$post({ json: payload })
    if (response.status !== 201)
      throw await toApiQueryError(response, 'Setup could not be completed.')
    return response.json()
  },
  onSuccess: async (session) => {
    queryCache.setQueryData(ADMIN_QUERY_KEYS.session, session)
    queryCache.setQueryData(ADMIN_QUERY_KEYS.setup, { required: false, available: true })
    await navigateTo('/admin')
  },
})

const loginMutation = useMutation({
  mutation: async (payload: AdminLoginPayload) => {
    const response = await apiClient.api.admin.login.$post({ json: payload })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'Administrator login failed.')
    return response.json()
  },
  onSuccess: async (session) => {
    queryCache.setQueryData(ADMIN_QUERY_KEYS.session, session)
    await navigateTo('/admin')
  },
})

const setupError = computed(() =>
  setupMutation.error.value instanceof Error ? setupMutation.error.value.message : '',
)
const loginError = computed(() =>
  loginMutation.error.value instanceof Error ? loginMutation.error.value.message : '',
)
const checkingDeployment = computed(
  () =>
    !setup.value &&
    (setupQuery.asyncStatus.value === 'loading' || sessionQuery.asyncStatus.value === 'loading'),
)
const settingUp = computed(() => setupMutation.asyncStatus.value === 'loading')
const signingIn = computed(() => loginMutation.asyncStatus.value === 'loading')
const showSetup = computed(() => Boolean(setup.value?.required && setup.value.available))
const setupLocked = computed(() => Boolean(setup.value?.required))

watch(
  () => sessionQuery.data.value?.authenticated,
  (authenticated) => {
    if (authenticated) void navigateTo('/admin')
  },
  { immediate: true },
)

useHead({ title: 'Administrator Login // EVE Space' })
</script>

<template>
  <AdminSetupWizard
    v-if="showSetup"
    :error-message="setupError"
    :submitting="settingUp"
    @submit="setupMutation.mutate($event)"
  />

  <section v-else-if="checkingDeployment" class="admin-access">
    <div class="admin-access-card">
      <div class="admin-access-progress auth-progress" aria-live="polite">
        <span class="app-scanner" aria-hidden="true" />
        <strong>Checking deployment state</strong>
      </div>
    </div>
  </section>

  <section v-else-if="setupLocked" class="admin-access">
    <div class="admin-access-card">
      <header class="admin-access-header">
        <div class="admin-access-heading">
          <p class="ui-eyebrow">SETUP LOCKED</p>
        </div>
        <h1>Bootstrap secret required</h1>
        <p>
          Configure the server-only <code>ADMIN_SETUP_SECRET</code> before creating the deployment
          owner.
        </p>
      </header>
    </div>
  </section>

  <AdminLoginForm
    v-else
    :error-message="loginError"
    :submitting="signingIn"
    @submit="loginMutation.mutate($event)"
  />
</template>

<style>
@import url('~/assets/css/pages/admin.css');
@import url('~/assets/css/responsive/admin.css');
</style>
