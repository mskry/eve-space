<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  platformAudience: 'public',
  title: 'Organization Review Disclosure',
})

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const announcer = useAnnouncer()
const disclosure = ref<Awaited<ReturnType<typeof loadDisclosure>> | null>(null)
const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')

onMounted(async () => {
  try {
    disclosure.value = await loadDisclosure()
  } catch {
    errorMessage.value = 'This authorization disclosure is unavailable or has expired.'
  } finally {
    loading.value = false
  }
})

async function loadDisclosure() {
  const response = await apiClient.auth.eve.disclosure.$get()
  if (!response.ok) {
    throw new Error('Disclosure unavailable')
  }
  return response.json()
}

async function continueAuthorization() {
  if (submitting.value) {
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await apiClient.auth.eve.disclosure.$post()
    if (!response.ok) {
      throw new Error('Disclosure acceptance failed')
    }
    const { authorizationUrl } = await response.json()
    announcer.polite('Disclosure accepted. Continuing to EVE Online.')
    await navigateTo(authorizationUrl, { external: true })
  } catch {
    errorMessage.value = 'Authorization could not continue. Start the authorization flow again.'
    announcer.assertive(errorMessage.value)
    submitting.value = false
  }
}

useHead({ title: 'Organization Review Disclosure // EVE Space' })
</script>

<template>
  <section class="auth-card reviewer-disclosure">
    <p class="ui-eyebrow">BEFORE EVE SSO</p>
    <h1>Organization review disclosure</h1>
    <p class="auth-intro">
      Continuing permits the enabled organization-review sections below to collect evidence for
      authorized HR staff and directors. Review what will be visible before authorizing the selected
      character.
    </p>

    <output v-if="loading" class="auth-progress">
      <span class="app-scanner" aria-hidden="true" />
      <strong>Loading disclosure</strong>
    </output>

    <p v-else-if="errorMessage" class="auth-feedback auth-error" role="alert">
      {{ errorMessage }}
    </p>

    <template v-else-if="disclosure">
      <ul class="reviewer-disclosure-list">
        <li
          v-for="section in disclosure.disclosures"
          :key="`${section.moduleId}/${section.sectionId}`"
        >
          <h2>{{ section.title }}</h2>
          <p>{{ section.purpose }}</p>
          <dl>
            <div>
              <dt>Fields</dt>
              <dd>{{ section.fields }}</dd>
            </div>
            <div>
              <dt>Retention</dt>
              <dd>{{ section.retention }}</dd>
            </div>
          </dl>
        </li>
      </ul>

      <p class="reviewer-disclosure-warning">
        {{ disclosure.undisclosedCharacterWarning }}
      </p>

      <div class="auth-actions">
        <button
          class="ui-action-primary"
          type="button"
          :disabled="submitting"
          @click="continueAuthorization"
        >
          {{ submitting ? 'CONTINUING...' : 'ACCEPT AND CONTINUE' }}
        </button>
        <NuxtLink class="ui-action-secondary" to="/">CANCEL</NuxtLink>
      </div>
    </template>
  </section>
</template>

<style scoped>
.reviewer-disclosure {
  width: min(44rem, 100%);
}

.reviewer-disclosure-list {
  display: grid;
  gap: 0.75rem;
  margin: 1.5rem 0;
  padding: 0;
  list-style: none;
  text-align: left;
}

.reviewer-disclosure-list li,
.reviewer-disclosure-warning {
  padding: 1rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-raised);
}

.reviewer-disclosure-list h2 {
  margin: 0 0 0.4rem;
  font-size: 1rem;
}

.reviewer-disclosure-list p,
.reviewer-disclosure-list dl,
.reviewer-disclosure-warning {
  margin: 0;
  color: var(--ui-text-muted);
}

.reviewer-disclosure-list dl {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.75rem;
}

.reviewer-disclosure-list dt {
  color: var(--ui-text);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reviewer-disclosure-list dd {
  margin: 0.15rem 0 0;
}

.reviewer-disclosure-warning {
  border-color: var(--ui-warning);
}
</style>
