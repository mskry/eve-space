import {
  platformReviewerContributionTargetResourceKey,
  type PlatformResourceState,
  type PlatformReviewerPanelProps,
} from '@eve-space/platform-module-nuxt/runtime'
import { computed } from 'vue'

export interface MemberAuditCollectionStatus {
  readonly resourceId: string
  readonly status:
    | 'current'
    | 'stale'
    | 'never-collected'
    | 'authorization-required'
    | 'unavailable'
  readonly validatedAt: string | null
  readonly authorizationGeneration?: number | null
  readonly disclosureVersion?: number
  readonly lastFailureClass?: string | null
  readonly requiredScope?: string
}

interface QueryContext {
  readonly signal: AbortSignal
}

interface ReviewerQueryResult {
  readonly data: { readonly value: unknown }
  readonly error: { readonly value: unknown }
  readonly status: { readonly value: string }
}

export function memberAuditReviewerQueryOptions<TData>(
  props: PlatformReviewerPanelProps,
  query: (context: QueryContext) => Promise<TData>,
) {
  return {
    access: { ...props.queryAccess, sectionId: props.sectionId },
    query,
    resource: platformReviewerContributionTargetResourceKey({
      contributionId: props.contributionId,
      sectionId: props.sectionId,
      target: props.target,
    }),
  }
}

export function withMemberAuditReviewerQueryState<Result extends ReviewerQueryResult>(
  props: PlatformReviewerPanelProps,
  result: Result,
) {
  const requestState = computed<PlatformResourceState>(() => {
    if (!props.queryAccess.authenticated || !props.queryAccess.authorized) {
      return {
        message: 'Your current organization authority does not permit this contribution.',
        status: 'authorization-required',
        title: 'Reviewer permission required',
      }
    }
    if (!props.queryAccess.moduleEnabled) {
      return {
        message: 'This contribution is not enabled for the current organization version.',
        status: 'unavailable',
        title: 'Member Audit is disabled',
      }
    }
    if (result.error.value) {
      return {
        message:
          result.error.value instanceof Error
            ? result.error.value.message
            : 'The contribution request failed.',
        retryLabel: 'Retry',
        status: 'unavailable',
        title: 'Member Audit data is unavailable',
      }
    }
    if (result.status.value === 'pending' && !result.data.value) {
      return { status: 'loading', title: 'Loading Member Audit data' }
    }
    return { status: 'ready' }
  })

  return { ...result, requestState }
}

export function collectionState(
  statuses: readonly MemberAuditCollectionStatus[],
  requestState: PlatformResourceState,
): PlatformResourceState {
  if (requestState.status !== 'ready') {
    return requestState
  }
  const authorizationRequired = statuses.find(({ status }) => status === 'authorization-required')
  if (authorizationRequired) {
    return {
      message: authorizationRequired.requiredScope
        ? `The character owner must authorize ${authorizationRequired.requiredScope}.`
        : 'The character owner must renew authorization for this evidence section.',
      status: 'authorization-required',
      title: 'Character authorization required',
    }
  }
  if (statuses.some(({ status }) => status === 'stale')) {
    return {
      message: 'The last complete observation is shown with its validation time.',
      retryLabel: 'Retry',
      status: 'stale',
      title: 'Evidence is stale',
    }
  }
  if (statuses.some(({ status }) => status === 'unavailable')) {
    return {
      message: 'Collection failed without exposing provider or persistence details.',
      retryLabel: 'Retry',
      status: 'unavailable',
      title: 'Evidence is unavailable',
    }
  }
  if (statuses.some(({ status }) => status === 'never-collected')) {
    return {
      message: 'No complete observation is available for this character.',
      retryLabel: 'Retry',
      status: 'unavailable',
      title: 'Evidence has not been collected',
    }
  }
  return { status: 'ready' }
}

export function targetLabel(props: PlatformReviewerPanelProps) {
  return props.target.kind === 'managed-organization-character'
    ? `Character ${props.target.characterId}`
    : `Member ${props.target.userId}`
}
