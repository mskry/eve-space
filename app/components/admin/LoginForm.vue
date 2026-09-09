<script setup lang="ts">
import type { AdminLoginPayload } from '../../types/admin'
import { isOwnerEmail } from '../../utils/admin-credentials'

const { errorMessage = '', submitting = false } = defineProps<{
  errorMessage?: string
  submitting?: boolean
}>()

const emit = defineEmits<{ submit: [payload: AdminLoginPayload] }>()

const email = ref('')
const password = ref('')
const passwordVisible = ref(false)
const capsLockOn = ref(false)

const hasError = computed(() => errorMessage.length > 0)
const canSubmit = computed(
  () => isOwnerEmail(email.value) && password.value.length > 0 && !submitting,
)
const passwordFieldType = computed(() => (passwordVisible.value ? 'text' : 'password'))
const passwordToggleLabel = computed(() => (passwordVisible.value ? 'HIDE' : 'SHOW'))
const submitLabel = computed(() => (submitting ? 'AUTHENTICATING...' : 'SIGN IN'))

function submitCredentials() {
  if (!canSubmit.value) return
  emit('submit', { email: email.value.trim(), password: password.value })
}

function togglePassword() {
  passwordVisible.value = !passwordVisible.value
}

function trackCapsLock(event: KeyboardEvent) {
  capsLockOn.value = event.getModifierState('CapsLock')
}

function clearCapsLock() {
  capsLockOn.value = false
}
</script>

<template>
  <section class="admin-access">
    <div class="admin-access-card">
      <header class="admin-access-header">
        <div class="admin-access-heading">
          <p class="ui-eyebrow">RESTRICTED ACCESS</p>
          <span class="admin-access-badge">OWNER</span>
        </div>
        <h1>Administrator login</h1>
        <p>Owner credentials only. Capsuleer accounts sign in through EVE SSO.</p>
      </header>

      <form class="admin-access-form" novalidate @submit.prevent="submitCredentials">
        <label class="admin-field">
          <span>Owner email</span>
          <input v-model="email" :aria-invalid="hasError" autocomplete="username" type="email" />
        </label>

        <label class="admin-field">
          <span>Password</span>
          <span class="admin-field-reveal" :data-invalid="hasError">
            <input
              v-model="password"
              :aria-invalid="hasError"
              autocomplete="current-password"
              :type="passwordFieldType"
              @blur="clearCapsLock"
              @keydown="trackCapsLock"
              @keyup="trackCapsLock"
            />
            <button type="button" @click="togglePassword">{{ passwordToggleLabel }}</button>
          </span>
          <small v-if="capsLockOn" class="admin-access-caps">Caps lock is on.</small>
        </label>

        <p v-if="hasError" class="ui-inline-error admin-access-error" role="alert">
          <strong>REJECTED</strong>
          <span>{{ errorMessage }}</span>
        </p>

        <button class="ui-action-primary" :disabled="!canSubmit" type="submit">
          {{ submitLabel }}
        </button>
      </form>
    </div>

    <p class="admin-access-note">
      Deployment-administrator access only. Sessions expire after 12 hours.
    </p>
  </section>
</template>

<style>
@import url('~/assets/css/pages/admin.css');
@import url('~/assets/css/responsive/admin.css');
</style>
