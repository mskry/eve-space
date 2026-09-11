<script setup lang="ts">
import { useMutation } from '@pinia/colada'
import { toApiQueryError } from '../utils/query-error'

definePageMeta({
  layout: 'auth',
  platformAudience: 'public',
  title: 'Character Transfer',
})

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const approvalId = shallowRef('')
const linkSecret = shallowRef('')
const linkState = ref<'loading' | 'ready' | 'invalid'>('loading')

const transferMutation = useMutation({
  mutation: async () => {
    const response = await apiClient.auth.eve.transfer.$post({
      json: { approvalId: approvalId.value, secret: linkSecret.value },
    })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'This transfer link cannot be used.')
    return response.json()
  },
  onSuccess: ({ authorizationUrl }) => {
    window.location.assign(authorizationUrl)
  },
})

const transferPending = computed(() => transferMutation.asyncStatus.value === 'loading')
const transferError = computed(() => {
  if (!transferMutation.error.value) return ''
  return 'This transfer link cannot be used from this session or is no longer valid. Sign in to the intended destination account and reopen it, or ask a deployment administrator for a replacement link.'
})

onMounted(() => {
  const parameters = new URLSearchParams(window.location.hash.slice(1))
  approvalId.value = parameters.get('approval') ?? ''
  linkSecret.value = parameters.get('secret') ?? ''
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  )
  linkState.value = approvalId.value && linkSecret.value ? 'ready' : 'invalid'
})

onBeforeUnmount(() => {
  approvalId.value = ''
  linkSecret.value = ''
})

useHead({ title: 'Character Transfer // EVE Space' })
</script>

<template>
  <section class="auth-card transfer-card">
    <div class="auth-card-mark" aria-hidden="true">
      <AppIcon name="auth" />
    </div>
    <p class="ui-eyebrow">APPROVED ACCOUNT REPAIR</p>
    <h1>Transfer one character</h1>
    <p class="auth-intro">
      A deployment administrator approved a narrowly bound character move. The link does not grant
      access by itself; the intended destination session and exact EVE character are still required.
    </p>

    <div v-if="linkState === 'loading' || authLoading" class="auth-progress" role="status">
      <span class="app-scanner" aria-hidden="true" />
      <strong>Checking destination session</strong>
    </div>

    <div v-else-if="linkState === 'invalid'" class="transfer-guidance" role="alert">
      <strong>TRANSFER LINK UNAVAILABLE</strong>
      <p>Ask a deployment administrator for a new transfer link.</p>
    </div>

    <div v-else-if="!authSession.authenticated" class="transfer-guidance">
      <strong>DESTINATION SIGN-IN REQUIRED</strong>
      <p>
        Sign in to the intended destination account, then reopen the original transfer link. This
        page cannot identify the intended account.
      </p>
      <NuxtLink class="ui-action-primary" to="/auth">SIGN IN WITH EVE ONLINE</NuxtLink>
    </div>

    <div v-else class="transfer-guidance">
      <strong>READY FOR EXACT-CHARACTER PROOF</strong>
      <p>
        You are signed in as {{ authSession.account.mainCharacter.name }}. Continue only if this is
        the intended destination account. EVE Online will ask you to select the exact approved
        character.
      </p>
      <p v-if="transferError" class="ui-inline-error" role="alert">{{ transferError }}</p>
      <button
        class="ui-action-primary"
        type="button"
        :disabled="transferPending"
        @click="transferMutation.mutate()"
      >
        {{ transferPending ? 'STARTING...' : 'CONTINUE TO EVE ONLINE' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.transfer-card {
  width: min(34rem, 100%);
}

.transfer-guidance {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  display: grid;
  gap: 0.9rem;
  border-top: 0.0625rem solid var(--ui-border);
}

.transfer-guidance > strong {
  color: var(--ui-primary);
  font: 700 0.625rem/1 var(--ui-font-mono);
  letter-spacing: 0.16em;
}

.transfer-guidance > p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 0.8rem;
  line-height: 1.6;
}

.transfer-guidance > .ui-action-primary {
  width: max-content;
}
</style>
