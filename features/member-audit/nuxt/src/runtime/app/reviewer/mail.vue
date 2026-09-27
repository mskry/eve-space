<script setup lang="ts">
import { computed } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { evidenceNames, evidenceText } from './evidence-presentation'
import {
  collectionState,
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const mail = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) => {
      if (props.target.kind !== 'managed-organization-character') {
        throw new Error('Select a disclosed character to review mail evidence.')
      }
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].mail.$get(
          {
            param: {
              characterId: String(props.target.characterId),
              userId: props.target.userId,
            },
          },
          { init: { signal } },
        ),
        'Mail evidence is unavailable.',
      )
    }),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'mail-detail',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const statuses = computed(() =>
  mail.data.value ? [mail.data.value.headers.status, mail.data.value.details.status] : [],
)
const state = computed(() => collectionState(statuses.value, mail.requestState.value))
const hasEvidence = computed(() =>
  Boolean(mail.data.value?.headers.evidence?.length || mail.data.value?.details.evidence?.length),
)
</script>

<template>
  <MemberAuditEvidencePanel
    description="Bounded mail headers and sanitized plain-text content retained for 90 days. Raw markup is never shown."
    :has-evidence="hasEvidence"
    permission="member-audit.mail.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Mail"
    @retry="mail.refetch()"
  >
    <template v-if="mail.data.value">
      <section>
        <h3>Message headers</h3>
        <p>
          Showing at most the {{ mail.data.value.previewLimit }} most recent retained headers. Older
          headers may exist.
        </p>
        <output v-if="!mail.data.value.headers.evidence?.length"
          >No readable message headers.</output
        >
        <ul v-else class="member-audit-evidence-list">
          <li
            v-for="header in mail.data.value.headers.evidence"
            :key="String(header.mailId)"
            class="member-audit-mail__entry"
          >
            <strong>{{ evidenceText(header.subject, '(No subject)') }}</strong>
            <span
              >From {{ evidenceText(header.senderName, 'Unknown sender') }} ·
              {{ evidenceText(header.sentAt, 'Date unavailable') }}</span
            >
            <span>To {{ evidenceNames(header.recipientNames) || 'Unknown recipients' }}</span>
          </li>
        </ul>
      </section>
      <section>
        <h3>Sanitized message content</h3>
        <p>
          Showing at most the {{ mail.data.value.previewLimit }} most recent retained messages.
          Older messages may exist.
        </p>
        <output v-if="!mail.data.value.details.evidence?.length"
          >No readable message content.</output
        >
        <ul v-else class="member-audit-evidence-list">
          <li
            v-for="message in mail.data.value.details.evidence"
            :key="String(message.mailId)"
            class="member-audit-mail__entry"
          >
            <strong>{{ evidenceText(message.subject, '(No subject)') }}</strong>
            <span
              >From {{ evidenceText(message.senderName, 'Unknown sender') }} ·
              {{ evidenceText(message.sentAt, 'Date unavailable') }}</span
            >
            <p class="member-audit-mail__body">{{ evidenceText(message.body, '(No content)') }}</p>
          </li>
        </ul>
      </section>
    </template>
  </MemberAuditEvidencePanel>
</template>

<style scoped>
.member-audit-mail__entry {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  overflow-wrap: anywhere;
}

.member-audit-mail__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
