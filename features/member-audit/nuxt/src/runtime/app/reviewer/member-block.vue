<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  readPlatformApiResponse,
  usePlatformReviewerActionInvalidation,
} from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditPanelFrame from './MemberAuditPanelFrame.vue'
import { useMemberAuditManagementAction } from './useMemberAuditManagementAction'
import {
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const invalidateReviewerAccess = usePlatformReviewerActionInvalidation()
const block = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) =>
      readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].block.$get(
          { param: { userId: props.target.userId } },
          { init: { signal } },
        ),
        'Member block state is unavailable.',
      ),
    ),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'block-actions',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const reason = ref('')
const confirmed = ref(false)
const confirmedContext = ref<{
  readonly organizationVersion: number
  readonly lifecycleId: string
}>()
watch(
  confirmed,
  (value) => {
    confirmedContext.value = value
      ? {
          organizationVersion: props.organizationVersion,
          lifecycleId: props.target.managedMemberLifecycleId,
        }
      : undefined
  },
  { flush: 'sync' },
)
const action = useMemberAuditManagementAction(
  props,
  async () => {
    await block.refetch()
  },
  () => {
    reason.value = ''
    confirmed.value = false
  },
  invalidateReviewerAccess,
)
const canSubmit = computed(
  () =>
    Boolean(reason.value.trim() && confirmed.value) &&
    confirmedContext.value?.organizationVersion === props.organizationVersion &&
    confirmedContext.value?.lifecycleId === props.target.managedMemberLifecycleId &&
    !action.pending.value &&
    action.authorized.value,
)

const changeBlock = async () => {
  if (!canSubmit.value || !block.data.value) {
    return
  }
  const expected = confirmedContext.value!
  const currentlyBlocked = block.data.value.block.blocked
  await action.run(
    async () => {
      const response = currentlyBlocked
        ? await api.api.modules['member-audit'].accounts[':userId'].block.$delete({
            json: {
              reason: reason.value.trim(),
              expectedOrganizationVersion: expected.organizationVersion,
              expectedManagedMemberLifecycleId: expected.lifecycleId,
            },
            param: { userId: props.target.userId },
          })
        : await api.api.modules['member-audit'].accounts[':userId'].block.$post({
            json: {
              reason: reason.value.trim(),
              expectedOrganizationVersion: expected.organizationVersion,
              expectedManagedMemberLifecycleId: expected.lifecycleId,
            },
            param: { userId: props.target.userId },
          })
      await readPlatformApiResponse(
        response,
        currentlyBlocked
          ? 'The member could not be unblocked.'
          : 'The member could not be blocked.',
      )
    },
    currentlyBlocked
      ? 'Member unblocked. Core will reevaluate current compliance and assignments.'
      : 'Member blocked. Protected organization access is denied immediately.',
    'The block action failed.',
  )
}
</script>

<template>
  <MemberAuditPanelFrame
    classification="Organization access data"
    description="Apply or remove the account-wide core deny for the selected managed account."
    permission="member-audit.members.block"
    :target="targetLabel(props)"
    title="Account block"
  >
    <PlatformResourceBoundary
      :state="block.requestState.value"
      :has-data="Boolean(block.data.value)"
      @retry="block.refetch()"
    >
      <output class="member-audit-block__state">
        Current state:
        <strong>{{ block.data.value?.block.blocked ? 'Blocked' : 'Not blocked' }}</strong>
        <template v-if="block.data.value?.block.blocked">
          since {{ block.data.value.block.blockedAt }}
        </template>
      </output>
    </PlatformResourceBoundary>

    <p class="member-audit-block__notice">
      Blocking this account immediately denies protected organization access for all its characters
      while preserving underlying group assignments for audit. Unblocking triggers a fresh core
      evaluation; it does not guarantee restored access.
    </p>
    <form class="member-audit-block__form" @submit.prevent="changeBlock">
      <label for="member-audit-block-reason">Audit reason</label>
      <textarea id="member-audit-block-reason" v-model.trim="reason" maxlength="2000" required />
      <label class="member-audit-block__confirmation">
        <input v-model="confirmed" type="checkbox" />
        I confirm the account-wide consequences for the selected managed account.
      </label>
      <button type="submit" :disabled="!canSubmit || !block.data.value">
        {{ block.data.value?.block.blocked ? 'Unblock account' : 'Block account' }}
      </button>
    </form>
    <output v-if="action.message.value" class="member-audit-block__result">{{
      action.message.value
    }}</output>
  </MemberAuditPanelFrame>
</template>

<style scoped>
.member-audit-block__state,
.member-audit-block__notice,
.member-audit-block__form {
  display: block;
  padding: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
}

.member-audit-block__form {
  display: grid;
  gap: 0.5rem;
}

.member-audit-block__form textarea {
  width: 100%;
  min-width: 0;
  min-height: 6rem;
  box-sizing: border-box;
  resize: vertical;
  color: var(--ui-text);
  background: var(--ui-surface-solid);
  border: 1px solid var(--ui-border-strong);
}

.member-audit-block__confirmation {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.member-audit-block__form :focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.member-audit-block__result {
  display: block;
  overflow-wrap: anywhere;
}
</style>
