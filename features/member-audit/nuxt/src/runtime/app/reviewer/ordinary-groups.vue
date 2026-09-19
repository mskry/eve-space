<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditPanelFrame from './MemberAuditPanelFrame.vue'
import {
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const groups = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) =>
      readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].groups.$get(
          { param: { userId: props.target.userId } },
          { init: { signal } },
        ),
        'Group assignments are unavailable.',
      ),
    ),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'group-actions',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const groupId = ref('')
const reason = ref('')
const expiresAt = ref('')
const confirmed = ref(false)
const actionPending = ref(false)
const actionMessage = ref('')
let actionRevision = 0
const canAssign = computed(
  () =>
    Boolean(groupId.value.trim() && reason.value.trim() && confirmed.value) && !actionPending.value,
)

watch(
  () => `${props.organizationVersion}/${JSON.stringify(props.target)}`,
  () => resetAction(),
  { flush: 'sync' },
)

async function assignGroup() {
  if (!canAssign.value) return
  actionPending.value = true
  actionMessage.value = ''
  const revision = actionRevision
  try {
    await readPlatformApiResponse(
      await api.api.modules['member-audit'].accounts[':userId'].groups[':groupId'].$post({
        param: { userId: props.target.userId, groupId: groupId.value.trim() },
        json: {
          reason: reason.value.trim(),
          expiresAt: expiresAt.value ? new Date(expiresAt.value).toISOString() : null,
        },
      }),
      'The ordinary group could not be assigned.',
    )
    if (revision !== actionRevision) return
    actionMessage.value = 'Ordinary group assigned. Entitlements will be reevaluated by core.'
    clearAction()
    await groups.refetch()
  } catch (error) {
    if (revision !== actionRevision) return
    actionMessage.value = error instanceof Error ? error.message : 'The group action failed.'
  } finally {
    if (revision === actionRevision) actionPending.value = false
  }
}

async function revokeGroup(group: NonNullable<typeof groups.data.value>['groups'][number]) {
  if (!confirmed.value || !reason.value.trim() || group.readOnly || actionPending.value) return
  actionPending.value = true
  actionMessage.value = ''
  const revision = actionRevision
  try {
    await readPlatformApiResponse(
      await api.api.modules['member-audit'].accounts[':userId'].groups[':groupId'].assignments[
        ':assignmentId'
      ].$delete({
        param: {
          userId: props.target.userId,
          groupId: group.groupId,
          assignmentId: group.assignmentId,
        },
        json: { reason: reason.value.trim() },
      }),
      'The ordinary group assignment could not be revoked.',
    )
    if (revision !== actionRevision) return
    actionMessage.value = `${group.name} revoked. Entitlements will be reevaluated by core.`
    clearAction()
    await groups.refetch()
  } catch (error) {
    if (revision !== actionRevision) return
    actionMessage.value = error instanceof Error ? error.message : 'The group action failed.'
  } finally {
    if (revision === actionRevision) actionPending.value = false
  }
}

function clearAction() {
  groupId.value = ''
  reason.value = ''
  expiresAt.value = ''
  confirmed.value = false
}

function resetAction() {
  actionRevision += 1
  clearAction()
  actionPending.value = false
  actionMessage.value = ''
}
</script>

<template>
  <MemberAuditPanelFrame
    classification="Organization access data"
    description="Assign or revoke non-restricted ordinary groups through audited core commands."
    permission="member-audit.groups.manage"
    :target="targetLabel(props)"
    title="Ordinary groups"
  >
    <p class="member-audit-groups__notice">
      Compliance-managed and restricted groups are read-only here. Use a member block when protected
      access must be removed immediately.
    </p>
    <PlatformResourceBoundary
      :state="groups.requestState.value"
      :has-data="Boolean(groups.data.value)"
      @retry="groups.refetch()"
    >
      <output v-if="!groups.data.value?.groups.length">
        This member has no current group assignments.
      </output>
      <ul v-else class="member-audit-groups__list">
        <li v-for="group in groups.data.value.groups" :key="group.assignmentId">
          <span>
            <strong>{{ group.name }}</strong>
            <small>
              {{ group.managementMode }} · {{ group.readOnly ? 'read-only' : 'ordinary' }}
            </small>
          </span>
          <button
            type="button"
            :disabled="group.readOnly || !confirmed || !reason.trim() || actionPending"
            @click="revokeGroup(group)"
          >
            Revoke
          </button>
        </li>
      </ul>
    </PlatformResourceBoundary>

    <form class="member-audit-groups__form" @submit.prevent="assignGroup">
      <h3>Assign an ordinary group</h3>
      <label for="member-audit-group-id">Group ID</label>
      <input id="member-audit-group-id" v-model.trim="groupId" required type="text" />
      <label for="member-audit-group-expiry">Expiry (optional)</label>
      <input id="member-audit-group-expiry" v-model="expiresAt" type="datetime-local" />
      <label for="member-audit-group-reason">Audit reason</label>
      <textarea id="member-audit-group-reason" v-model.trim="reason" maxlength="2000" required />
      <label class="member-audit-groups__confirmation">
        <input v-model="confirmed" type="checkbox" />
        I confirm this access decision applies to the selected managed member.
      </label>
      <button type="submit" :disabled="!canAssign">Assign ordinary group</button>
    </form>
    <output v-if="actionMessage" class="member-audit-groups__result">{{ actionMessage }}</output>
  </MemberAuditPanelFrame>
</template>

<style scoped>
.member-audit-groups__notice,
.member-audit-groups__form,
.member-audit-groups__list li {
  padding: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
}

.member-audit-groups__list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.member-audit-groups__list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.member-audit-groups__list span,
.member-audit-groups__list small {
  display: block;
  overflow-wrap: anywhere;
}

.member-audit-groups__list small {
  color: var(--ui-text-muted);
}

.member-audit-groups__form {
  display: grid;
  gap: 0.5rem;
}

.member-audit-groups__form input,
.member-audit-groups__form textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  color: var(--ui-text);
  background: var(--ui-surface-solid);
  border: 1px solid var(--ui-border-strong);
}

.member-audit-groups__form textarea {
  min-height: 6rem;
  resize: vertical;
}

.member-audit-groups__confirmation {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.member-audit-groups__form :focus-visible,
.member-audit-groups__list button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.member-audit-groups__result {
  display: block;
  overflow-wrap: anywhere;
}
</style>
