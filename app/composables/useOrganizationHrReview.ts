import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { adminSetupQuery } from '../queries/admin'
import {
  organizationAuditQuery,
  organizationContextQuery,
  organizationExceptionsQuery,
  type OrganizationAudit,
} from '../queries/organization'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'

interface ApproveExceptionInput {
  userId: string
  characterId: number
  reason: string
  expiresAt: string | null
}

export function useOrganizationHrReview(apiClient: ApiClient) {
  const queryCache = useQueryCache()
  const { authSession, initializeAuth } = useAuthSession(apiClient)
  const setupQuery = useQuery({ ...adminSetupQuery(apiClient), enabled: import.meta.client })
  const contextQuery = useQuery({
    ...organizationContextQuery(apiClient),
    enabled: () =>
      import.meta.client &&
      authSession.value.authenticated &&
      setupQuery.data.value?.required === false,
  })
  const canReview = computed(
    () => contextQuery.data.value?.capabilities.reviewRegistration === true,
  )
  const exceptionsQuery = useQuery({
    ...organizationExceptionsQuery(apiClient),
    enabled: () => import.meta.client && canReview.value,
  })
  const beforeAuditSequence = ref<string | null>(null)
  const auditQuery = useQuery(() => ({
    ...organizationAuditQuery(apiClient, beforeAuditSequence.value),
    enabled: import.meta.client && canReview.value,
  }))
  const auditEvents = ref<OrganizationAudit['events']>([])

  watch(
    () => auditQuery.data.value,
    (page) => {
      if (!page) return
      if (beforeAuditSequence.value === null) auditEvents.value = page.events
      else {
        const existingIds = new Set(auditEvents.value.map(({ auditId }) => auditId))
        auditEvents.value = [
          ...auditEvents.value,
          ...page.events.filter(({ auditId }) => !existingIds.has(auditId)),
        ]
      }
    },
    { immediate: true },
  )

  const approveMutation = useMutation({
    mutation: async (input: ApproveExceptionInput) => {
      const response = await apiClient.api.organization.members[':userId'].characters[
        ':characterId'
      ].exception.$post({
        param: { userId: input.userId, characterId: String(input.characterId) },
        json: { reason: input.reason, expiresAt: input.expiresAt },
      })
      if (response.status !== 201) {
        throw await toApiQueryError(response, 'Character exception could not be approved.')
      }
      return response.json()
    },
  })
  const decisionMutation = useMutation({
    mutation: async (input: {
      exceptionId: string
      decision: 'expire' | 'revoke'
      reason: string
    }) => {
      const route = apiClient.api.organization.exceptions[':exceptionId'][input.decision]
      const response = await route.$post({
        param: { exceptionId: input.exceptionId },
        json: { reason: input.reason },
      })
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character exception could not be updated.')
      }
      return response.json()
    },
  })

  const errorMessage = computed(() => {
    const error =
      approveMutation.error.value ??
      decisionMutation.error.value ??
      setupQuery.error.value ??
      contextQuery.error.value ??
      exceptionsQuery.error.value ??
      auditQuery.error.value
    return error instanceof Error ? error.message : ''
  })
  const loading = computed(
    () =>
      setupQuery.asyncStatus.value === 'loading' ||
      (contextQuery.asyncStatus.value === 'loading' && !contextQuery.data.value) ||
      (exceptionsQuery.asyncStatus.value === 'loading' && !exceptionsQuery.data.value) ||
      (auditQuery.asyncStatus.value === 'loading' && !auditQuery.data.value),
  )
  const hasOlderAuditEvents = computed(() =>
    Boolean(auditQuery.data.value?.nextBeforeAuditSequence),
  )
  const auditLoading = computed(() => auditQuery.asyncStatus.value === 'loading')
  const mutationPending = computed(
    () =>
      approveMutation.asyncStatus.value === 'loading' ||
      decisionMutation.asyncStatus.value === 'loading',
  )

  async function initialize() {
    const [authenticated, setup] = await Promise.all([initializeAuth(), setupQuery.refresh()])
    if (!authenticated || setup.data?.required !== false) return
    const context = await contextQuery.refresh()
    if (!context.data?.capabilities.reviewRegistration) return
    await Promise.all([exceptionsQuery.refresh(), auditQuery.refresh()])
  }

  async function refreshReviewData() {
    beforeAuditSequence.value = null
    auditEvents.value = []
    await Promise.all([
      queryCache.invalidateQueries({
        exact: true,
        key: organizationExceptionsQuery(apiClient).key,
      }),
      queryCache.invalidateQueries({
        exact: true,
        key: organizationAuditQuery(apiClient, null).key,
      }),
    ])
  }

  async function approveException(input: ApproveExceptionInput) {
    await approveMutation.mutateAsync(input)
    await refreshReviewData()
  }

  async function decideException(
    exceptionId: string,
    decision: 'expire' | 'revoke',
    reason: string,
  ) {
    await decisionMutation.mutateAsync({ exceptionId, decision, reason })
    await refreshReviewData()
  }

  function loadOlderAuditEvents() {
    const cursor = auditQuery.data.value?.nextBeforeAuditSequence
    if (cursor) beforeAuditSequence.value = cursor
  }

  return {
    approveException,
    auditEvents,
    auditLoading,
    canReview,
    decideException,
    errorMessage,
    exceptions: computed(() => exceptionsQuery.data.value?.exceptions ?? []),
    reviewCandidates: computed(() => exceptionsQuery.data.value?.reviewCandidates ?? []),
    hasOlderAuditEvents,
    initialize,
    loadOlderAuditEvents,
    loading,
    mutationPending,
  }
}
