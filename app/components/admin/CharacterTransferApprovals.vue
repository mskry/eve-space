<script setup lang="ts">
import { useMutation } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../../utils/api-client'
import { toApiQueryError } from '../../utils/query-error'

type TransferApprovalClient = ApiClient['api']['admin']['character-transfer-approvals']
type TransferPreview = InferResponseType<TransferApprovalClient['preview']['$post'], 200>['preview']
type TransferApproval = InferResponseType<TransferApprovalClient['$post'], 201>['approval']
type TransferApprovalInspection = InferResponseType<
  TransferApprovalClient[':approvalId']['$get'],
  200
>

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const characterId = ref('')
const destinationMainCharacterId = ref('')
const reason = ref('')
const transferPreview = ref<TransferPreview>()
const approval = ref<TransferApproval>()
const approvalId = ref('')
const transferLink = ref('')
const audit = ref<TransferApprovalInspection['audit']>([])
const revocationReason = ref('')
const feedback = ref('')

const previewMutation = useMutation({
  mutation: async () => {
    const response = await apiClient.api.admin['character-transfer-approvals'].preview.$post({
      json: {
        characterId: Number(characterId.value),
        destinationMainCharacterId: Number(destinationMainCharacterId.value),
        reason: reason.value,
      },
    })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'Transfer preview could not be created.')
    return response.json()
  },
  onSuccess: ({ preview }) => {
    transferPreview.value = preview
    approval.value = undefined
    approvalId.value = ''
    transferLink.value = ''
    audit.value = []
    feedback.value = preview.eligible
      ? 'Preview ready. Confirm the immutable transfer details before approval.'
      : transferBlockerGuidance(preview.blocker)
  },
})

const approvalMutation = useMutation({
  mutation: async () => {
    if (!transferPreview.value?.eligible) throw new Error('Create an eligible preview first.')
    const response = await apiClient.api.admin['character-transfer-approvals'].$post({
      json: { previewId: transferPreview.value.previewId },
    })
    if (response.status !== 201)
      throw await toApiQueryError(response, 'Transfer approval could not be created.')
    return response.json()
  },
  onSuccess: (result) => {
    approval.value = result.approval
    approvalId.value = result.approval.approvalId
    transferLink.value = result.transferLink
    audit.value = []
    feedback.value = 'Approval created. Send the one-time link to the intended destination user.'
  },
})

const inspectionMutation = useMutation({
  mutation: async () => {
    const response = await apiClient.api.admin['character-transfer-approvals'][':approvalId'].$get({
      param: { approvalId: approvalId.value },
    })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'Transfer approval could not be loaded.')
    return response.json()
  },
  onSuccess: (result) => {
    approval.value = result.approval
    audit.value = result.audit
    transferLink.value = ''
    feedback.value = 'Approval status refreshed.'
  },
})

const revocationMutation = useMutation({
  mutation: async () => {
    if (!approval.value) throw new Error('Load an approval before revoking it.')
    const response = await apiClient.api.admin['character-transfer-approvals'][
      ':approvalId'
    ].revoke.$post({
      param: { approvalId: approval.value.approvalId },
      json: { reason: revocationReason.value },
    })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'Transfer approval could not be revoked.')
    return response.json()
  },
  onSuccess: (result) => {
    approval.value = result.approval
    revocationReason.value = ''
    transferLink.value = ''
    audit.value = []
    feedback.value = 'Transfer approval revoked.'
  },
})

const errorMessage = computed(() => {
  for (const mutation of [
    previewMutation,
    approvalMutation,
    inspectionMutation,
    revocationMutation,
  ]) {
    if (mutation.error.value instanceof Error) return mutation.error.value.message
  }
  return ''
})
const previewPending = computed(() => previewMutation.asyncStatus.value === 'loading')
const approvalPending = computed(() => approvalMutation.asyncStatus.value === 'loading')
const inspectionPending = computed(() => inspectionMutation.asyncStatus.value === 'loading')
const revocationPending = computed(() => revocationMutation.asyncStatus.value === 'loading')

watch([characterId, destinationMainCharacterId, reason], () => {
  transferPreview.value = undefined
})

async function copyTransferLink() {
  if (!transferLink.value) return
  try {
    await navigator.clipboard.writeText(transferLink.value)
    feedback.value = 'Transfer link copied.'
  } catch {
    feedback.value = 'Transfer link could not be copied. Select and copy it manually.'
  }
}

function formatTransferDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

function transferBlockerGuidance(blocker: Exclude<TransferPreview, { eligible: true }>['blocker']) {
  if (blocker === 'main-character')
    return 'Select another source main character, then preview again.'
  if (blocker === 'authority-evidence')
    return 'Remove active organization-owner authority through the authorized organization workflow.'
  if (blocker === 'corporation-source')
    return 'Replace or revoke the active corporation data source through the authorized workflow.'
  if (blocker === 'destination-main')
    return 'Enter the destination account’s current main-character ID.'
  if (blocker === 'same-account')
    return 'The selected characters already belong to the same account.'
  return 'The specified transfer identities are unavailable.'
}
</script>

<template>
  <section class="admin-panel admin-transfer-panel">
    <div class="admin-transfer-heading">
      <div>
        <p class="ui-eyebrow">ACCOUNT REPAIR</p>
        <h2>Character transfer approval</h2>
      </div>
      <p>
        Preview one exact character move. Approval never transfers account authority, other
        characters, or private history.
      </p>
    </div>

    <output v-if="feedback" class="auth-feedback">{{ feedback }}</output>
    <p v-if="errorMessage" class="ui-inline-error" role="alert">{{ errorMessage }}</p>

    <form class="admin-form admin-transfer-form" @submit.prevent="previewMutation.mutate()">
      <label>
        Moving character ID
        <input v-model="characterId" type="number" min="1" inputmode="numeric" required />
      </label>
      <label>
        Destination main-character ID
        <input
          v-model="destinationMainCharacterId"
          type="number"
          min="1"
          inputmode="numeric"
          required
        />
      </label>
      <label class="admin-transfer-reason">
        Approval reason
        <textarea v-model="reason" maxlength="1000" rows="3" required></textarea>
        <small>{{ reason.length }} / 1000</small>
      </label>
      <button class="ui-action-primary" type="submit" :disabled="previewPending">
        {{ previewPending ? 'CHECKING...' : 'PREVIEW TRANSFER' }}
      </button>
    </form>

    <div v-if="transferPreview" class="admin-transfer-result" aria-live="polite">
      <template v-if="transferPreview.eligible">
        <div class="admin-transfer-identities">
          <div>
            <span>MOVE</span>
            <strong>{{ transferPreview.character.name }}</strong>
            <code>{{ transferPreview.character.characterId }}</code>
          </div>
          <div>
            <span>DESTINATION MAIN</span>
            <strong>{{ transferPreview.destinationMain.name }}</strong>
            <code>{{ transferPreview.destinationMain.characterId }}</code>
          </div>
        </div>
        <p>Source character count: {{ transferPreview.sourceCharacterCount }}</p>
        <p>Preview expires {{ formatTransferDate(transferPreview.expiresAt) }}.</p>
        <button
          class="ui-action-primary"
          type="button"
          :disabled="approvalPending"
          @click="approvalMutation.mutate()"
        >
          {{ approvalPending ? 'CREATING...' : 'CREATE APPROVAL' }}
        </button>
      </template>
      <p v-else class="ui-inline-error" role="alert">
        {{ transferBlockerGuidance(transferPreview.blocker) }}
      </p>
    </div>

    <div v-if="transferLink" class="admin-transfer-link">
      <label for="transfer-link">One-time destination link</label>
      <input id="transfer-link" :value="transferLink" readonly />
      <button class="ui-action-secondary" type="button" @click="copyTransferLink">COPY LINK</button>
    </div>

    <form class="admin-transfer-status" @submit.prevent="inspectionMutation.mutate()">
      <label for="transfer-approval-id">Approval ID</label>
      <input
        id="transfer-approval-id"
        v-model="approvalId"
        type="text"
        autocomplete="off"
        required
      />
      <button class="ui-action-secondary" type="submit" :disabled="inspectionPending">
        {{ inspectionPending ? 'LOADING...' : 'CHECK STATUS' }}
      </button>
    </form>

    <div v-if="approval" class="admin-transfer-approval">
      <div class="admin-transfer-approval-heading">
        <div>
          <span>APPROVAL STATUS</span>
          <strong :data-status="approval.status">{{ approval.status.toUpperCase() }}</strong>
        </div>
        <span>Expires {{ formatTransferDate(approval.expiresAt) }}</span>
      </div>
      <dl>
        <dt>Character</dt>
        <dd>{{ approval.character.name }} / {{ approval.character.characterId }}</dd>
        <dt>Destination main</dt>
        <dd>{{ approval.destinationMain.name }} / {{ approval.destinationMain.characterId }}</dd>
        <dt>Reason</dt>
        <dd>{{ approval.reason }}</dd>
      </dl>

      <form
        v-if="approval.status === 'pending'"
        class="admin-transfer-revoke"
        @submit.prevent="revocationMutation.mutate()"
      >
        <label for="transfer-revocation-reason">Revocation reason</label>
        <textarea
          id="transfer-revocation-reason"
          v-model="revocationReason"
          maxlength="1000"
          rows="2"
          required
        ></textarea>
        <button class="ui-action-secondary" type="submit" :disabled="revocationPending">
          {{ revocationPending ? 'REVOKING...' : 'REVOKE APPROVAL' }}
        </button>
      </form>

      <ol v-if="audit.length" class="admin-transfer-audit" aria-label="Approval history">
        <li v-for="entry in audit" :key="`${entry.action}:${entry.occurredAt}`">
          <strong>{{ entry.action.toUpperCase() }}</strong>
          <span>{{ formatTransferDate(entry.occurredAt) }}</span>
          <p>{{ entry.reason }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>
