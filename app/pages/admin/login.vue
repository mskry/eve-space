<script setup lang="ts">
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { adminSessionQuery, adminSetupQuery } from '../../queries/admin'
import { ADMIN_QUERY_KEYS } from '../../queries/query-keys'
import { toApiQueryError } from '../../utils/query-error'

definePageMeta({ layout: 'auth', title: 'Administrator Login' })

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const setupQuery = useQuery(adminSetupQuery(apiClient))
const sessionQuery = useQuery(() => ({
  ...adminSessionQuery(apiClient),
  enabled: import.meta.client,
}))
const setupSecret = ref('')
const email = ref('')
const password = ref('')
const organizationType = ref<'corporation' | 'alliance'>('corporation')
const organizationId = ref('')
const setup = setupQuery.data

const setupMutation = useMutation({
  mutation: async () => {
    const response = await apiClient.api.admin.setup.$post({
      json: {
        setupSecret: setupSecret.value,
        email: email.value,
        password: password.value,
        organizationType: organizationType.value,
        organizationId: organizationId.value,
      },
    })
    if (response.status !== 201)
      throw await toApiQueryError(response, 'Setup could not be completed.')
    return response.json()
  },
  onSuccess: async (session) => {
    queryCache.setQueryData(ADMIN_QUERY_KEYS.session, session)
    queryCache.setQueryData(ADMIN_QUERY_KEYS.setup, { required: false, available: true })
    setupSecret.value = ''
    password.value = ''
    await navigateTo('/admin')
  },
})

const loginMutation = useMutation({
  mutation: async () => {
    const response = await apiClient.api.admin.login.$post({
      json: { email: email.value, password: password.value },
    })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'Administrator login failed.')
    return response.json()
  },
  onSuccess: async (session) => {
    queryCache.setQueryData(ADMIN_QUERY_KEYS.session, session)
    password.value = ''
    await navigateTo('/admin')
  },
})

const activeError = computed(() => {
  const error = setupMutation.error.value ?? loginMutation.error.value
  return error instanceof Error ? error.message : ''
})
const loading = computed(
  () => setupQuery.asyncStatus.value === 'loading' || sessionQuery.asyncStatus.value === 'loading',
)
const submitting = computed(
  () =>
    setupMutation.asyncStatus.value === 'loading' || loginMutation.asyncStatus.value === 'loading',
)

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
  <section class="auth-card admin-auth-card">
    <div class="auth-card-mark" aria-hidden="true"><AppIcon name="admin" /></div>

    <div v-if="loading && !setup" class="auth-progress" aria-live="polite">
      <span class="scanner" aria-hidden="true" />
      <strong>Checking deployment state</strong>
    </div>

    <template v-else-if="setup?.required && !setup.available">
      <p class="eyebrow">SETUP LOCKED</p>
      <h1>Bootstrap secret required</h1>
      <p class="auth-intro">
        Configure the server-only <code>ADMIN_SETUP_SECRET</code> before creating the deployment
        owner.
      </p>
    </template>

    <form v-else-if="setup?.required" class="admin-form" @submit.prevent="setupMutation.mutate()">
      <div class="admin-panel-heading">
        <span>01</span>
        <div>
          <p class="eyebrow">ONE-TIME SETUP</p>
          <h1>Create deployment owner</h1>
        </div>
      </div>
      <label
        >Setup secret<input v-model="setupSecret" type="password" autocomplete="off" required
      /></label>
      <label
        >Owner email<input v-model="email" type="email" autocomplete="username" required
      /></label>
      <label
        >Owner password<input
          v-model="password"
          type="password"
          minlength="12"
          autocomplete="new-password"
          required
      /></label>
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
      <p v-if="activeError" class="inline-error" role="alert">{{ activeError }}</p>
      <button class="primary-action" type="submit" :disabled="submitting">
        {{ submitting ? 'VERIFYING...' : 'COMPLETE SETUP' }}
      </button>
    </form>

    <form v-else class="admin-form admin-login" @submit.prevent="loginMutation.mutate()">
      <div class="admin-panel-heading">
        <span>OWNER</span>
        <div>
          <p class="eyebrow">RESTRICTED ACCESS</p>
          <h1>Administrator login</h1>
        </div>
      </div>
      <label
        >Owner email<input v-model="email" type="email" autocomplete="username" required
      /></label>
      <label
        >Password<input v-model="password" type="password" autocomplete="current-password" required
      /></label>
      <p v-if="activeError" class="inline-error" role="alert">{{ activeError }}</p>
      <button class="primary-action" type="submit" :disabled="submitting">
        {{ submitting ? 'AUTHENTICATING...' : 'SIGN IN' }}
      </button>
    </form>
  </section>
</template>
