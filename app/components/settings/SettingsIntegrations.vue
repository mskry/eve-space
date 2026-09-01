<script setup lang="ts">
import type { DelegatedOrganizationRole } from '../../queries/organization'

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const {
  authorityContext,
  errorMessage,
  grantRole,
  initialize,
  loading,
  mutationPending,
  revokeRole,
  roleGrants,
} = useOrganizationAuthority(apiClient)
const { characters, loadCharacterRoster } = useCharacterRoster(apiClient)

const claimCharacterId = ref<number | null>(null)
const targetUserId = ref('')
const delegatedRole = ref<DelegatedOrganizationRole>('hr_auditor')
const grantReason = ref('')
const revokeGrantId = ref<string | null>(null)
const revokeReason = ref('')
const actionMessage = ref('')

const integrations = [
  {
    name: 'EVE Public ESI',
    detail: 'Character, corporation, alliance, race and bloodline records.',
    state: 'ACTIVE',
    tone: 'active',
  },
  {
    name: 'EVE SSO',
    detail: 'Authorization Code flow, encrypted tokens and local sessions.',
    state: 'CONFIGURED',
    tone: 'active',
  },
  {
    name: 'Character Wallet',
    detail: 'Protected balance with ETag revalidation and quota protection.',
    state: 'SCOPE BASED',
    tone: 'warning',
  },
]

const ownerFeedback = computed(() => {
  if (route.query.organizationOwner === 'success')
    return 'Organization-owner authority was verified.'
  if (route.query.organizationOwner === 'cancelled') return 'Authority verification was cancelled.'
  if (route.query.organizationOwner === 'error')
    return 'Authority verification failed. Confirm the character affiliation, EVE Director role, and requested scope.'
  return ''
})
const ownerFeedbackError = computed(
  () => route.query.organizationOwner === 'error' || route.query.organizationOwner === 'cancelled',
)

watch(
  characters,
  (roster) => {
    if (claimCharacterId.value === null) {
      claimCharacterId.value = roster.find((character) => character.isMain)?.characterId ?? null
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await initialize()
  await loadCharacterRoster()
})

async function startOwnerClaim() {
  if (!claimCharacterId.value) return
  const destination = new URL(
    `/auth/eve/claim-organization-owner/${claimCharacterId.value}`,
    runtimeConfig.public.apiBase,
  )
  await navigateTo(destination.toString(), { external: true })
}

async function submitGrant() {
  actionMessage.value = ''
  try {
    await grantRole({
      userId: targetUserId.value.trim(),
      role: delegatedRole.value,
      reason: grantReason.value.trim(),
    })
    targetUserId.value = ''
    grantReason.value = ''
    actionMessage.value = 'Organization role granted.'
  } catch {
    actionMessage.value = ''
  }
}

async function submitRevocation() {
  if (!revokeGrantId.value) return
  actionMessage.value = ''
  try {
    await revokeRole(revokeGrantId.value, revokeReason.value.trim())
    closeRevocation()
    actionMessage.value = 'Organization role revoked.'
  } catch {
    actionMessage.value = ''
  }
}

function openRevocation(grantId: string) {
  revokeGrantId.value = grantId
  revokeReason.value = ''
}

function closeRevocation() {
  revokeGrantId.value = null
  revokeReason.value = ''
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp),
  )
}

function roleLabel(role: DelegatedOrganizationRole) {
  return role === 'hr_auditor' ? 'HR / Auditor' : 'Director'
}
</script>

<template>
  <div class="settings-integrations-stack">
    <section class="settings-subsection" aria-labelledby="organization-authority-heading">
      <header class="settings-subsection-heading">
        <div>
          <p class="ui-eyebrow">01 / EVE AUTHORITY</p>
          <h2 id="organization-authority-heading">Organization authority</h2>
        </div>
        <p>Verified in-game authority for organization governance and private-data access.</p>
      </header>

      <div class="authority-separation-note">
        <strong>Separate security boundary</strong>
        <p>
          Deployment administration configures this installation. It does not grant organization
          membership, HR, director, owner, or private-data access.
        </p>
      </div>

      <output
        v-if="ownerFeedback"
        class="authority-feedback"
        :class="{ 'authority-feedback--error': ownerFeedbackError }"
      >
        {{ ownerFeedback }}
      </output>
      <p v-if="errorMessage" class="ui-inline-error" role="alert">{{ errorMessage }}</p>
      <p class="sr-only" aria-live="polite">{{ actionMessage }}</p>

      <div v-if="loading && !authorityContext" class="authority-loading">Loading authority...</div>
      <div v-else-if="authorityContext" class="authority-console">
        <div class="authority-organization-strip">
          <div>
            <span>Managed {{ authorityContext.organization.organizationType }}</span>
            <strong>
              {{ authorityContext.organization.organizationName }}
              [{{ authorityContext.organization.organizationTicker }}]
            </strong>
          </div>
          <span class="integration-state active"
            >VERSION {{ authorityContext.organization.organizationVersion }}</span
          >
        </div>

        <article v-if="authorityContext.authorityCharacter" class="authority-evidence-card">
          <div class="authority-evidence-marker" aria-hidden="true">EVE</div>
          <div>
            <span>Authority supplied by</span>
            <h3>{{ authorityContext.authorityCharacter.name }}</h3>
            <p>
              Character {{ authorityContext.authorityCharacter.characterId }} / Corporation
              {{ authorityContext.authorityCharacter.corporationId }}
            </p>
          </div>
          <dl>
            <div>
              <dt>Evidence</dt>
              <dd>{{ authorityContext.ownerStatus }}</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{{ formatTimestamp(authorityContext.authorityCharacter.lastCheckedAt) }}</dd>
            </div>
          </dl>
        </article>

        <div v-else-if="authorityContext.claimAvailable" class="authority-claim-panel">
          <div>
            <span class="authority-step">CLAIM 01</span>
            <h3>Verify an organization owner</h3>
            <p>
              Choose an attached EVE character. EVE SSO will request corporation-role access and
              verify current affiliation and the Director role.
            </p>
          </div>
          <form class="authority-claim-form" @submit.prevent="startOwnerClaim">
            <label for="authority-character">Authority character</label>
            <select id="authority-character" v-model="claimCharacterId" required>
              <option :value="null" disabled>Select a character</option>
              <option
                v-for="character in characters"
                :key="character.characterId"
                :value="character.characterId"
              >
                {{ character.name }} / {{ character.corporation.name }}
              </option>
            </select>
            <button class="ui-action-primary" type="submit" :disabled="!claimCharacterId">
              VERIFY WITH EVE SSO
            </button>
          </form>
        </div>

        <div v-else class="authority-claimed-state">
          <strong>Organization owner already verified</strong>
          <p>
            A current EVE-backed owner claim exists. Role administration is available only to that
            signed-in owner; deployment-admin login does not unlock it.
          </p>
        </div>
      </div>

      <NuxtLink
        v-if="authorityContext?.capabilities.viewRosterCoverage"
        class="ui-action-secondary"
        to="/settings/roster-coverage"
      >
        OPEN ROSTER COVERAGE
      </NuxtLink>
    </section>

    <section
      v-if="authorityContext?.isOrganizationOwner"
      class="settings-subsection"
      aria-labelledby="organization-roles-heading"
    >
      <header class="settings-subsection-heading">
        <div>
          <p class="ui-eyebrow">02 / DELEGATED ACCESS</p>
          <h2 id="organization-roles-heading">Organization roles</h2>
        </div>
        <p>
          Explicit, version-bound grants. Every change requires a reason and enters the audit
          ledger.
        </p>
      </header>

      <div class="role-management-grid">
        <form class="role-grant-form" @submit.prevent="submitGrant">
          <span class="authority-step">NEW GRANT</span>
          <label for="role-user-id">EVE Space user ID</label>
          <input
            id="role-user-id"
            v-model="targetUserId"
            type="text"
            inputmode="text"
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
          <label for="organization-role">Role</label>
          <select id="organization-role" v-model="delegatedRole">
            <option value="hr_auditor">HR / Auditor</option>
            <option value="director">Director</option>
          </select>
          <label for="grant-reason">Reason</label>
          <textarea id="grant-reason" v-model="grantReason" maxlength="2000" required></textarea>
          <button class="ui-action-primary" type="submit" :disabled="mutationPending">
            GRANT ROLE
          </button>
        </form>

        <div class="role-grant-list">
          <div v-if="roleGrants.length === 0" class="role-grant-empty">
            No delegated organization roles are active.
          </div>
          <article v-for="grant in roleGrants" :key="grant.grantId" class="role-grant-row">
            <div>
              <span>{{ roleLabel(grant.role) }}</span>
              <strong>{{ grant.mainCharacterName ?? grant.userId }}</strong>
              <p v-if="grant.mainCharacterName">User {{ grant.userId }}</p>
              <p>{{ grant.reason }}</p>
            </div>
            <button
              class="ui-action-secondary"
              type="button"
              :disabled="mutationPending"
              @click="openRevocation(grant.grantId)"
            >
              REVOKE
            </button>
            <form
              v-if="revokeGrantId === grant.grantId"
              class="role-revoke-form"
              @submit.prevent="submitRevocation"
            >
              <label :for="`revoke-reason-${grant.grantId}`">Revocation reason</label>
              <textarea
                :id="`revoke-reason-${grant.grantId}`"
                v-model="revokeReason"
                maxlength="2000"
                required
              ></textarea>
              <div>
                <button class="ui-action-primary" type="submit" :disabled="mutationPending">
                  CONFIRM REVOCATION
                </button>
                <button class="ui-action-secondary" type="button" @click="closeRevocation">
                  CANCEL
                </button>
              </div>
            </form>
          </article>
        </div>
      </div>
    </section>

    <section class="settings-subsection" aria-labelledby="settings-integrations-heading">
      <header class="settings-subsection-heading">
        <div>
          <p class="ui-eyebrow">03 / SETTINGS</p>
          <h2 id="settings-integrations-heading">Integrations</h2>
        </div>
        <p>Connected services and their authorization boundaries.</p>
      </header>
      <div class="integration-list">
        <article
          v-for="(integration, index) in integrations"
          :key="integration.name"
          class="integration-row"
        >
          <span class="integration-index">0{{ index + 1 }}</span>
          <div>
            <strong>{{ integration.name }}</strong>
            <p>{{ integration.detail }}</p>
          </div>
          <span class="integration-state" :class="integration.tone">{{ integration.state }}</span>
        </article>
      </div>
    </section>
  </div>
</template>

<style>
@import url('~/assets/css/pages/settings.css');
@import url('~/assets/css/responsive/settings.css');
</style>
