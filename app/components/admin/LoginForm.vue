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
const attempted = ref(false)

const hasError = computed(() => errorMessage.length > 0)
const emailInvalid = computed(() => attempted.value && !isOwnerEmail(email.value))
const passwordInvalid = computed(() => attempted.value && password.value.length === 0)
const credentialsValid = computed(() => isOwnerEmail(email.value) && password.value.length > 0)
const emailHasError = computed(() => emailInvalid.value || hasError.value)
const passwordHasError = computed(() => passwordInvalid.value || hasError.value)
const emailDescription = computed(
  () =>
    [emailInvalid.value && 'admin-login-email-error', hasError.value && 'admin-login-error']
      .filter(Boolean)
      .join(' ') || undefined,
)
const passwordDescription = computed(
  () =>
    [
      passwordInvalid.value && 'admin-login-password-error',
      hasError.value && 'admin-login-error',
      capsLockOn.value && 'admin-login-caps',
    ]
      .filter(Boolean)
      .join(' ') || undefined,
)
const passwordFieldType = computed(() => (passwordVisible.value ? 'text' : 'password'))
const passwordToggleLabel = computed(() => (passwordVisible.value ? 'HIDE' : 'SHOW'))
const passwordToggleDescription = computed(() =>
  passwordVisible.value ? 'Hide password' : 'Show password',
)
const submitLabel = computed(() => (submitting ? 'AUTHENTICATING...' : 'SIGN IN'))

function submitCredentials() {
  attempted.value = true
  if (!credentialsValid.value || submitting) return
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
        <div class="admin-field">
          <label for="admin-login-email">Owner email</label>
          <input
            id="admin-login-email"
            v-model="email"
            :aria-describedby="emailDescription"
            :aria-invalid="emailHasError"
            autocomplete="username"
            name="email"
            type="email"
          />
          <small v-if="emailInvalid" id="admin-login-email-error" data-invalid="true" role="alert">
            Enter a valid owner email address.
          </small>
        </div>

        <div class="admin-field">
          <label for="admin-login-password">Password</label>
          <span class="admin-field-reveal" :data-invalid="passwordHasError">
            <input
              id="admin-login-password"
              v-model="password"
              :aria-describedby="passwordDescription"
              :aria-invalid="passwordHasError"
              autocomplete="current-password"
              name="password"
              :type="passwordFieldType"
              @blur="clearCapsLock"
              @keydown="trackCapsLock"
              @keyup="trackCapsLock"
            />
            <button
              :aria-label="passwordToggleDescription"
              :aria-pressed="passwordVisible"
              type="button"
              @click="togglePassword"
            >
              {{ passwordToggleLabel }}
            </button>
          </span>
          <small
            v-if="passwordInvalid"
            id="admin-login-password-error"
            data-invalid="true"
            role="alert"
          >
            Enter the owner password.
          </small>
          <small v-if="capsLockOn" id="admin-login-caps" class="admin-access-caps">
            Caps lock is on.
          </small>
        </div>

        <p
          v-if="hasError"
          id="admin-login-error"
          class="ui-inline-error admin-access-error"
          role="alert"
        >
          <strong>REJECTED</strong>
          <span>{{ errorMessage }}</span>
        </p>

        <button class="ui-action-primary" :disabled="submitting" type="submit">
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
