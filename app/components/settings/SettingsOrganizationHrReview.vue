<script setup lang="ts">
import type { OrganizationExceptions } from '../../queries/organization'
import { organizationReasonLabel } from '../../utils/organization-presentation'

type ReviewCandidate = OrganizationExceptions['reviewCandidates'][number]

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const {
  approveException,
  auditEvents,
  auditLoading,
  canReview,
  decideException,
  errorMessage,
  exceptions,
  hasOlderAuditEvents,
  initialize,
  loadOlderAuditEvents,
  loading,
  mutationPending,
  reviewCandidates,
} = useOrganizationHrReview(apiClient)

const approvalReason = ref('')
const expiresAt = ref('')
const selectedCandidateKey = ref<string | null>(null)
const selectedExceptionId = ref<string | null>(null)
const decisionReason = ref('')

const activeExceptions = computed(() =>
  exceptions.value.filter((exception) => !exception.expiredAt && !exception.revokedAt),
)

onMounted(initialize)

function candidateKey(candidate: ReviewCandidate) {
  return `${candidate.userId}:${candidate.characterId}`
}

function openApproval(candidate: ReviewCandidate) {
  selectedCandidateKey.value = candidateKey(candidate)
  approvalReason.value = ''
  expiresAt.value = ''
}

function closeApproval() {
  selectedCandidateKey.value = null
  approvalReason.value = ''
  expiresAt.value = ''
}

async function submitApproval(candidate: ReviewCandidate) {
  await approveException({
    userId: candidate.userId,
    characterId: candidate.characterId,
    reason: approvalReason.value.trim(),
    expiresAt: expiresAt.value ? new Date(expiresAt.value).toISOString() : null,
  })
  closeApproval()
}

function openDecision(exceptionId: string) {
  selectedExceptionId.value = exceptionId
  decisionReason.value = ''
}

function closeDecision() {
  selectedExceptionId.value = null
  decisionReason.value = ''
}

async function submitDecision(decision: 'expire' | 'revoke') {
  if (!selectedExceptionId.value) return
  await decideException(selectedExceptionId.value, decision, decisionReason.value.trim())
  closeDecision()
}
</script>

<template>
  <section class="settings-integrations-stack organization-hr-review">
    <header class="settings-subsection-heading">
      <div>
        <span class="eyebrow">Organization controls</span>
        <h2>HR review</h2>
      </div>
      <p>Current-version roster evidence, external-character decisions, and audit outcomes.</p>
    </header>

    <p v-if="errorMessage" class="authority-feedback authority-feedback--error" role="alert">
      {{ errorMessage }}
    </p>

    <p v-if="loading" class="authority-loading" aria-live="polite">Loading HR review data...</p>
    <p v-else-if="!canReview" class="authority-loading">
      A current HR auditor grant and compliant account are required to review private organization
      data.
    </p>

    <template v-else>
      <section class="hr-review-panel" aria-labelledby="exceptions-heading">
        <div class="hr-review-panel__heading">
          <div>
            <span class="authority-step">Decisions</span>
            <h3 id="exceptions-heading">External-character exceptions</h3>
          </div>
          <span class="integration-state active">{{ activeExceptions.length }} active</span>
        </div>

        <div class="hr-review-subheading">
          <h4>Awaiting exception review</h4>
          <span>{{ reviewCandidates.length }} candidates</span>
        </div>
        <p v-if="!reviewCandidates.length" class="hr-review-empty">
          No external-character exception candidates require review.
        </p>
        <article
          v-for="candidate in reviewCandidates"
          :key="candidateKey(candidate)"
          class="hr-review-row hr-review-row--candidate"
        >
          <div>
            <strong>{{ candidate.characterName }} / {{ candidate.characterId }}</strong>
            <p>{{ organizationReasonLabel(candidate.reasonCode) }}</p>
            <p>Account {{ candidate.userId }} / {{ candidate.state.replaceAll('_', ' ') }}</p>
            <p>
              Evidence {{ candidate.evidenceFreshness }} / affiliation checked
              <NuxtTime
                v-if="candidate.affiliationCheckedAt"
                :datetime="candidate.affiliationCheckedAt"
              />
              <span v-else>not recorded</span>
            </p>
            <p v-if="candidate.reviewDeadline">
              Review deadline <NuxtTime :datetime="candidate.reviewDeadline" />
            </p>
          </div>
          <button class="ui-action-primary" type="button" @click="openApproval(candidate)">
            Review candidate
          </button>
          <form
            v-if="selectedCandidateKey === candidateKey(candidate)"
            class="hr-candidate-form"
            @submit.prevent="submitApproval(candidate)"
          >
            <label>
              Expires at
              <input v-model="expiresAt" type="datetime-local" />
            </label>
            <label>
              Approval reason
              <textarea v-model="approvalReason" required minlength="1"></textarea>
            </label>
            <div>
              <button class="ui-action-secondary" type="button" @click="closeApproval">
                Cancel
              </button>
              <button class="ui-action-primary" type="submit" :disabled="mutationPending">
                Approve exception
              </button>
            </div>
          </form>
        </article>

        <div class="hr-review-subheading">
          <h4>Recorded decisions</h4>
          <span>{{ exceptions.length }} total</span>
        </div>

        <p v-if="!exceptions.length" class="hr-review-empty">No exception decisions recorded.</p>
        <article
          v-for="exception in exceptions"
          :key="exception.exceptionId"
          class="hr-review-row hr-review-row--decision"
        >
          <div>
            <strong>{{ exception.characterName }} / {{ exception.characterId }}</strong>
            <p>{{ exception.reason }}</p>
            <p>
              User {{ exception.userId }} / approved <NuxtTime :datetime="exception.approvedAt" />
            </p>
          </div>
          <button
            v-if="!exception.expiredAt && !exception.revokedAt"
            class="ui-action-secondary"
            type="button"
            @click="openDecision(exception.exceptionId)"
          >
            Review
          </button>
          <span v-else class="integration-state muted">
            {{ exception.revokedAt ? 'revoked' : 'expired' }}
          </span>
          <form
            v-if="selectedExceptionId === exception.exceptionId"
            class="hr-decision-form"
            @submit.prevent="submitDecision('revoke')"
          >
            <label>
              Decision reason
              <textarea v-model="decisionReason" required></textarea>
            </label>
            <div>
              <button class="ui-action-secondary" type="button" @click="closeDecision">
                Cancel
              </button>
              <button
                class="ui-action-secondary"
                type="button"
                :disabled="mutationPending || !decisionReason.trim()"
                @click="submitDecision('expire')"
              >
                Expire
              </button>
              <button class="ui-action-primary" type="submit" :disabled="mutationPending">
                Revoke
              </button>
            </div>
          </form>
        </article>
      </section>

      <section class="hr-review-panel" aria-labelledby="audit-heading">
        <div class="hr-review-panel__heading">
          <div>
            <span class="authority-step">Audit</span>
            <h3 id="audit-heading">Decision history</h3>
          </div>
          <span class="integration-state muted">append-only</span>
        </div>
        <p v-if="!auditEvents.length" class="hr-review-empty">No audit outcomes recorded.</p>
        <ol v-else class="hr-audit-list">
          <li v-for="event in auditEvents" :key="event.auditId">
            <div>
              <strong>{{ event.eventType }}</strong>
              <span>#{{ event.auditSequence }} / {{ event.outcome }}</span>
              <span>Actor: {{ event.actorType }} / {{ event.actorId ?? 'system' }}</span>
              <span
                >Subject: {{ event.subjectType }} / {{ event.subjectId ?? 'not recorded' }}</span
              >
              <span v-if="event.targetUserId">Affected account: {{ event.targetUserId }}</span>
            </div>
            <p>{{ event.reason }}</p>
            <time :datetime="event.occurredAt">
              <NuxtTime :datetime="event.occurredAt" date-style="medium" time-style="short" />
            </time>
          </li>
        </ol>
        <button
          v-if="hasOlderAuditEvents"
          class="ui-action-secondary hr-audit-more"
          type="button"
          :disabled="auditLoading"
          @click="loadOlderAuditEvents"
        >
          Load older events
        </button>
      </section>
    </template>
  </section>
</template>
