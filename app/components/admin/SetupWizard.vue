<script setup lang="ts">
import type { AdminOrganizationType, AdminSetupPayload } from '../../types/admin'
import { isOwnerEmail } from '../../utils/admin-credentials'

const { errorMessage = '', submitting = false } = defineProps<{
  errorMessage?: string
  submitting?: boolean
}>()

const emit = defineEmits<{ submit: [payload: AdminSetupPayload] }>()

const stepCopy = {
  1: {
    blurb:
      'The owner account holds full administrative rights over this deployment, including ESI token custody and member access. It cannot be created again.',
    headline: 'Create deployment owner',
    title: 'Deployment owner',
  },
  2: {
    blurb:
      'Confirm the owner account and the organization this deployment manages. Launching commits the deployment and invalidates the setup secret.',
    headline: 'Verify and launch',
    title: 'Verify & launch',
  },
} as const
const organizationTypeOptions = [
  { label: 'Corporation', value: 'corporation' },
  { label: 'Alliance', value: 'alliance' },
]
const passwordStrengthLabels = ['NONE', 'WEAK', 'FAIR', 'GOOD', 'STRONG'] as const

const step = ref(1)
const attempted = ref(false)
const setupSecret = ref('')
const secretVisible = ref(false)
const email = ref('')
const password = ref('')
const organizationType = ref<AdminOrganizationType>('corporation')
const organizationId = ref('')

const organizationTypeSelection = computed<string>({
  get: () => organizationType.value,
  set: (value) => {
    if (value === 'corporation' || value === 'alliance') organizationType.value = value
  },
})
const fieldErrors = computed(() => ({
  email: !isOwnerEmail(email.value),
  organizationId: !/^[1-9]\d*$/.test(organizationId.value.trim()),
  password: password.value.length < 12,
  setupSecret: setupSecret.value.trim().length === 0,
}))
const ownerStepValid = computed(() => !Object.values(fieldErrors.value).some(Boolean))
const invalid = computed(() => ({
  email: attempted.value && fieldErrors.value.email,
  organizationId: attempted.value && fieldErrors.value.organizationId,
  password: attempted.value && fieldErrors.value.password,
  setupSecret: attempted.value && fieldErrors.value.setupSecret,
}))
const passwordScore = computed(() => {
  const value = password.value
  if (!value) return 0
  let score = 0
  if (value.length >= 12) score += 1
  if (value.length >= 16) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  if (/[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) score += 1
  return Math.min(score, 4)
})
const passwordStrengthLabel = computed(() => passwordStrengthLabels[passwordScore.value] ?? 'NONE')
const activeCopy = computed(() => (step.value === 1 ? stepCopy[1] : stepCopy[2]))
const steps = computed(() => [
  { title: stepCopy[1].title, value: 1 },
  { disabled: !ownerStepValid.value, title: stepCopy[2].title, value: 2 },
])
const organizationLabel = computed(() =>
  organizationType.value === 'alliance' ? 'Alliance' : 'Corporation',
)
const organizationInitial = computed(() => organizationLabel.value.slice(0, 1))
const secretToggleLabel = computed(() => (secretVisible.value ? 'HIDE' : 'SHOW'))
const secretToggleDescription = computed(() =>
  secretVisible.value ? 'Hide setup secret' : 'Show setup secret',
)
const secretFieldType = computed(() => (secretVisible.value ? 'text' : 'password'))
const secretHint = computed(() =>
  invalid.value.setupSecret
    ? 'Enter the setup secret printed when the deployment first booted.'
    : 'Look for ADMIN_SETUP_SECRET in the API container configuration.',
)
const emailHint = computed(() =>
  invalid.value.email
    ? 'Enter a valid address — it becomes the administrator login.'
    : 'Becomes the administrator login for this deployment.',
)
const organizationIdHint = computed(() =>
  invalid.value.organizationId
    ? 'Enter the numeric EVE ID without spaces or separators.'
    : `Numeric ID from the ${organizationLabel.value.toLowerCase()} record.`,
)
const resolvedEntity = computed(() =>
  fieldErrors.value.organizationId
    ? 'Awaiting ID'
    : `${organizationLabel.value} ${organizationId.value.trim()}`,
)
const summaryRows = computed(() => [
  { label: 'Setup secret', value: 'Provided' },
  { label: 'Owner email', value: email.value.trim() },
  { label: 'Owner password', value: `•••••••••••• · ${passwordStrengthLabel.value}` },
  { label: 'Organization', value: organizationLabel.value },
  { label: `${organizationLabel.value} ID`, value: organizationId.value.trim() },
])
const footerNote = computed(() => {
  if (attempted.value && !ownerStepValid.value) return 'Fix the highlighted fields to continue.'
  if (step.value === 1) return 'Setup runs once. The secret is destroyed when the owner is created.'
  return 'Launching creates the owner account and locks this deployment to it.'
})
const submitLabel = computed(() => {
  if (step.value === 1) return 'CONTINUE'
  return submitting ? 'LAUNCHING...' : 'LAUNCH DEPLOYMENT'
})

function submitStep() {
  if (!ownerStepValid.value) {
    attempted.value = true
    step.value = 1
    return
  }
  if (step.value === 1) {
    attempted.value = false
    step.value = 2
    return
  }
  emit('submit', {
    email: email.value.trim(),
    organizationId: organizationId.value.trim(),
    organizationType: organizationType.value,
    password: password.value,
    setupSecret: setupSecret.value,
  })
}

function toggleSecret() {
  secretVisible.value = !secretVisible.value
}

function returnToOwnerStep() {
  step.value = 1
}
</script>

<template>
  <section class="admin-setup">
    <header class="admin-setup-intro">
      <p class="ui-eyebrow">ONE-TIME SETUP</p>
      <h1>{{ activeCopy.headline }}</h1>
      <p class="admin-setup-blurb">{{ activeCopy.blurb }}</p>
    </header>

    <UiStepper v-model="step" label="Deployment setup" :steps="steps" />

    <form class="admin-setup-form" novalidate @submit.prevent="submitStep">
      <template v-if="step === 1">
        <section class="admin-setup-section">
          <p class="ui-eyebrow">AUTHORIZATION</p>
          <div class="admin-field">
            <label for="admin-setup-secret">Setup secret</label>
            <span class="admin-field-reveal" :data-invalid="invalid.setupSecret">
              <input
                id="admin-setup-secret"
                v-model="setupSecret"
                aria-describedby="admin-setup-secret-hint"
                :aria-invalid="invalid.setupSecret"
                autocomplete="off"
                name="setupSecret"
                spellcheck="false"
                :type="secretFieldType"
              />
              <button
                :aria-label="secretToggleDescription"
                :aria-pressed="secretVisible"
                type="button"
                @click="toggleSecret"
              >
                {{ secretToggleLabel }}
              </button>
            </span>
            <small id="admin-setup-secret-hint" :data-invalid="invalid.setupSecret">
              {{ secretHint }}
            </small>
          </div>
        </section>

        <section class="admin-setup-section">
          <p class="ui-eyebrow">OWNER CREDENTIALS</p>
          <div class="admin-setup-split">
            <label class="admin-field">
              <span>Owner email</span>
              <input
                v-model="email"
                aria-describedby="admin-setup-email-hint"
                :aria-invalid="invalid.email"
                autocomplete="username"
                type="email"
              />
              <small id="admin-setup-email-hint" :data-invalid="invalid.email">
                {{ emailHint }}
              </small>
            </label>
            <label class="admin-field">
              <span>Owner password</span>
              <input
                v-model="password"
                aria-describedby="admin-setup-password-hint"
                :aria-invalid="invalid.password"
                autocomplete="new-password"
                type="password"
              />
              <small
                id="admin-setup-password-hint"
                class="admin-setup-strength"
                :data-invalid="invalid.password"
              >
                <span class="admin-setup-strength-track">
                  <span class="admin-setup-strength-bar" :data-score="passwordScore" />
                </span>
                <span class="admin-setup-strength-label" :data-score="passwordScore">
                  {{ passwordStrengthLabel }}
                </span>
                <span class="admin-setup-strength-rule">Minimum 12 characters</span>
              </small>
            </label>
          </div>
        </section>

        <section class="admin-setup-section">
          <p class="ui-eyebrow">ORGANIZATION</p>
          <div class="admin-field">
            <span>Organization type</span>
            <UiToggleGroup
              v-model="organizationTypeSelection"
              label="Organization type"
              :options="organizationTypeOptions"
            />
          </div>
          <div class="admin-setup-split">
            <label class="admin-field">
              <span>EVE {{ organizationLabel }} ID</span>
              <input
                v-model="organizationId"
                aria-describedby="admin-setup-organization-hint"
                :aria-invalid="invalid.organizationId"
                inputmode="numeric"
                spellcheck="false"
              />
              <small id="admin-setup-organization-hint" :data-invalid="invalid.organizationId">
                {{ organizationIdHint }}
              </small>
            </label>
            <div class="admin-field">
              <span>Resolved</span>
              <p class="admin-setup-resolved">
                <span aria-hidden="true">{{ organizationInitial }}</span>
                {{ resolvedEntity }}
              </p>
              <small>Verified against ESI when the deployment launches.</small>
            </div>
          </div>
        </section>
      </template>

      <section v-else class="admin-setup-section">
        <p class="ui-eyebrow">REVIEW</p>
        <dl class="admin-setup-summary">
          <template v-for="row in summaryRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
        <p class="admin-setup-warning">
          <strong>IRREVERSIBLE</strong>
          <span>
            Launching destroys the setup secret and locks ownership to this account. Recovery
            requires database access.
          </span>
        </p>
      </section>

      <p v-if="errorMessage" class="ui-inline-error" role="alert">{{ errorMessage }}</p>

      <footer class="admin-setup-controls">
        <p class="admin-setup-note" :data-invalid="attempted && !ownerStepValid">
          {{ footerNote }}
        </p>
        <div class="admin-setup-actions">
          <button
            class="ui-action-secondary"
            :disabled="step === 1"
            type="button"
            @click="returnToOwnerStep"
          >
            BACK
          </button>
          <button class="ui-action-primary" :disabled="submitting" type="submit">
            {{ submitLabel }}
          </button>
        </div>
      </footer>
    </form>
  </section>
</template>

<style>
@import url('~/assets/css/pages/admin.css');
@import url('~/assets/css/responsive/admin.css');
</style>
