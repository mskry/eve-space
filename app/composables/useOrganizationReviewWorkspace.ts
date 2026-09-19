import { useQuery, useQueryCache } from '@pinia/colada'
import {
  removePlatformQueryScope,
  removePlatformReviewerContributionTargetQueries,
  type PlatformReviewerContributionTargetIdentity,
  type PlatformReviewerPanelCatalogEntry,
  type PlatformReviewerPanelQueryAccess,
  type PlatformReviewerSelectedTarget,
} from '@eve-space/platform-module-nuxt/runtime'
import { ApiQueryError } from '../utils/query-error'
import {
  organizationReviewDirectoryQuery,
  organizationReviewEntryQuery,
  organizationReviewTargetQuery,
  type OrganizationReviewDirectoryInput,
  type OrganizationReviewDirectoryMember,
  type OrganizationReviewTargetInput,
  type OrganizationReviewTargetMember,
  type OrganizationReviewTargetResult,
} from '../queries/organization-review'
import { PRIVATE_QUERY_KEYS } from '../queries/query-keys'
import { createApiClient } from '../utils/api-client'
import {
  availableOrganizationReviewerPanels,
  parseOrganizationReviewUrlState,
  reviewerContributionIdentity,
  selectedReviewerTarget,
} from '../utils/organization-review'

const defaultDirectoryLimit = 25

interface OrganizationReviewNavigation {
  readonly route: { readonly query: Record<string, unknown> }
  readonly router: {
    push(location: { readonly query: Record<string, string> }): unknown
    replace(location: { readonly query: Record<string, string> }): unknown
  }
}

export function useOrganizationReviewWorkspace(navigation?: OrganizationReviewNavigation) {
  const route = navigation?.route ?? useRoute()
  const router = navigation?.router ?? useRouter()
  const queryCache = useQueryCache()
  const announcer = useAnnouncer()
  const apiClient = createApiClient(useRuntimeConfig().public.apiBase)
  const { authLoading, authSession } = useAuthSession(apiClient)
  const { enabledModuleIds, enabledSectionKeys, runtimeQuery } = usePlatformModuleRuntime()
  const panelCatalog = usePlatformReviewerPanels()
  const searchText = ref('')
  const corporationText = ref('')
  const limit = ref(defaultDirectoryLimit)
  const cursor = ref<string>()
  const cursorHistory = ref<string[]>([])
  const appliedQuery = ref<string>()
  const appliedCorporationId = ref<number>()
  const panelFocusRequest = ref(0)

  const entryQuery = useQuery(() =>
    organizationReviewEntryQuery({
      apiClient,
      authenticated: authSession.value.authenticated,
    }),
  )
  const entryError = computed(() => entryQuery.error.value)
  const canonicalDenial = computed(
    () => entryError.value instanceof ApiQueryError && [403, 404].includes(entryError.value.status),
  )
  const authorizedContributions = computed(() =>
    entryError.value ? [] : (entryQuery.data.value?.contributions ?? []),
  )
  const catalogContributions = computed(() =>
    availableOrganizationReviewerPanels(authorizedContributions.value, panelCatalog.contributions),
  )
  const availableContributions = computed(() =>
    catalogContributions.value.filter(
      (contribution) =>
        enabledModuleIds.value.has(contribution.moduleId) &&
        (!contribution.sectionId ||
          enabledSectionKeys.value.has(`${contribution.moduleId}/${contribution.sectionId}`)),
    ),
  )
  const organizationVersion = computed(() => entryQuery.data.value?.organizationVersion ?? 0)
  const urlState = computed(() => parseOrganizationReviewUrlState(route.query))
  const directoryInput = computed<OrganizationReviewDirectoryInput>(() => ({
    organizationVersion: organizationVersion.value,
    query: appliedQuery.value,
    corporationId: appliedCorporationId.value,
    cursor: cursor.value,
    limit: limit.value,
  }))
  const directoryQuery = useQuery(() =>
    organizationReviewDirectoryQuery({
      apiClient,
      enabled:
        authSession.value.authenticated &&
        !entryError.value &&
        availableContributions.value.length > 0,
      input: directoryInput.value,
    }),
  )
  const members = computed(() =>
    directoryQuery.error.value ? [] : (directoryQuery.data.value?.items ?? []),
  )
  const browseSelectedMember = computed(() =>
    members.value.find(({ account }) => account.userId === urlState.value.targetUserId),
  )
  const targetInput = computed<OrganizationReviewTargetInput>(() => ({
    organizationVersion: organizationVersion.value,
    targetUserId: urlState.value.targetUserId ?? '',
    targetCharacterId: urlState.value.targetCharacterId,
    managedMemberLifecycleId: browseSelectedMember.value?.managedMemberLifecycleId,
  }))
  const targetLookupRequired = computed(() => urlState.value.targetUserId !== undefined)
  const targetQuery = useQuery(() =>
    organizationReviewTargetQuery({
      apiClient,
      enabled:
        authSession.value.authenticated &&
        !entryError.value &&
        availableContributions.value.length > 0 &&
        targetLookupRequired.value,
      input: targetInput.value,
    }),
  )
  const selectedMember = computed(
    () =>
      currentTargetLookupMember(targetQuery.data.value, targetInput.value) ??
      browseSelectedMember.value,
  )
  const selectedContribution = computed(() => {
    return availableContributions.value.find(
      (contribution) => reviewerContributionIdentity(contribution) === urlState.value.contribution,
    )
  })
  const selectedTarget = computed<PlatformReviewerSelectedTarget | undefined>(() => {
    if (!selectedMember.value || !selectedContribution.value) return undefined
    const section = selectedContribution.value.sectionId
      ? runtimeQuery.data.value?.enabledSections.find(
          ({ moduleId, sectionId }) =>
            moduleId === selectedContribution.value!.moduleId &&
            sectionId === selectedContribution.value!.sectionId,
        )
      : { disclosureVersion: 1, activationVersion: 1 }
    return selectedReviewerTarget(
      selectedMember.value,
      selectedContribution.value,
      urlState.value.targetCharacterId,
      section,
    )
  })
  const queryAccess = computed<PlatformReviewerPanelQueryAccess>(() => ({
    authenticated: authSession.value.authenticated,
    authorized:
      !entryError.value &&
      selectedContribution.value !== undefined &&
      authorizedContributions.value.some(
        (contribution) =>
          reviewerContributionIdentity(contribution) ===
          reviewerContributionIdentity(selectedContribution.value!),
      ),
    moduleEnabled:
      selectedContribution.value !== undefined &&
      enabledModuleIds.value.has(selectedContribution.value.moduleId) &&
      (!selectedContribution.value.sectionId ||
        enabledSectionKeys.value.has(
          `${selectedContribution.value.moduleId}/${selectedContribution.value.sectionId}`,
        )),
  }))

  watch(
    [
      availableContributions,
      members,
      urlState,
      () => directoryQuery.asyncStatus.value,
      () => targetQuery.asyncStatus.value,
      () => targetQuery.data.value,
      () => targetQuery.error.value,
    ],
    () => canonicalizeLocation(),
    { flush: 'post' },
  )
  watch(limit, () => {
    cursor.value = undefined
    cursorHistory.value = []
  })
  watch(
    () => currentTargetQueryIdentity(),
    (current, previous) => {
      if (!previous || sameTargetQueryIdentity(previous, current)) return
      if (entryError.value && !canonicalDenial.value) return
      removePlatformReviewerContributionTargetQueries(queryCache, previous)
    },
    { flush: 'sync' },
  )
  watch(
    organizationVersion,
    (current, previous) => {
      if (previous > 0 && previous !== current)
        removePlatformQueryScope(
          queryCache,
          PRIVATE_QUERY_KEYS.organizationReviewerVersion(previous),
        )
    },
    { flush: 'sync' },
  )
  watch(canonicalDenial, (denied) => {
    if (!denied || organizationVersion.value <= 0) return
    removePlatformQueryScope(
      queryCache,
      PRIVATE_QUERY_KEYS.organizationReviewerVersion(organizationVersion.value),
    )
  })

  async function submitSearch() {
    appliedQuery.value = normalizedSearch(searchText.value)
    appliedCorporationId.value = positiveInteger(corporationText.value)
    cursor.value = undefined
    cursorHistory.value = []
    await nextTick()
    const result = await directoryQuery.refresh()
    const count = result.data?.items.length ?? 0
    announcer.polite(`${count} managed ${count === 1 ? 'member' : 'members'} found.`)
  }

  async function nextDirectoryPage() {
    const nextCursor = directoryQuery.data.value?.nextCursor
    if (!nextCursor) return
    cursorHistory.value = [...cursorHistory.value, cursor.value ?? '']
    cursor.value = nextCursor
    await announceDirectoryPage()
  }

  async function previousDirectoryPage() {
    const history = [...cursorHistory.value]
    const previous = history.pop()
    cursorHistory.value = history
    cursor.value = previous || undefined
    await announceDirectoryPage()
  }

  async function selectMember(member: OrganizationReviewDirectoryMember) {
    const contribution = selectedContribution.value
    announcer.polite(`Selected ${member.account.mainCharacter?.name ?? 'managed member'}.`)
    await router.push({
      query: contribution
        ? canonicalQuery(member, contribution)
        : { targetUserId: member.account.userId },
    })
    await nextTick()
    if (contribution) panelFocusRequest.value += 1
  }

  async function selectContribution(identity: string) {
    const contribution = availableContributions.value.find(
      (candidate) => reviewerContributionIdentity(candidate) === identity,
    )
    if (!contribution) return
    await router.push({
      query: selectedMember.value
        ? canonicalQuery(selectedMember.value, contribution, urlState.value.targetCharacterId)
        : { contribution: identity },
    })
  }

  async function retryEntry() {
    await Promise.all([entryQuery.refetch(), runtimeQuery.refetch()])
  }

  async function retryDirectory() {
    await directoryQuery.refetch()
  }

  async function announceDirectoryPage() {
    await nextTick()
    const result = await directoryQuery.refresh()
    announcer.polite(`Loaded ${result.data?.items.length ?? 0} managed members.`)
  }

  function canonicalizeLocation() {
    if (!entryQuery.data.value) return
    if (!runtimeQuery.data.value) return
    if (directoryQuery.asyncStatus.value === 'loading') return
    if (
      targetLookupRequired.value &&
      targetQuery.asyncStatus.value === 'loading' &&
      !currentTargetLookupResult(targetQuery.data.value, targetInput.value)
    )
      return
    const state = urlState.value
    const contribution = selectedContribution.value
    if (!contribution) {
      canonicalizeLocationWithoutContribution()
      return
    }
    if (!state.targetUserId) {
      replaceWithContribution(contribution)
      return
    }
    const member = selectedMember.value
    if (!member) {
      canonicalizeUnresolvedTarget(contribution)
      return
    }
    replaceLocationQuery(canonicalQuery(member, contribution, state.targetCharacterId))
  }

  function canonicalizeLocationWithoutContribution() {
    const state = urlState.value
    if (!state.targetUserId) {
      if (!state.contribution && !state.targetCharacterId) return
      replaceLocationQuery({})
      return
    }
    const member = selectedMember.value
    if (!member) {
      canonicalizeUnresolvedTarget()
      return
    }
    replaceLocationQuery({ targetUserId: member.account.userId })
  }

  function replaceWithContribution(contribution: PlatformReviewerPanelCatalogEntry) {
    replaceLocationQuery({ contribution: reviewerContributionIdentity(contribution) })
  }

  function canonicalizeUnresolvedTarget(contribution?: PlatformReviewerPanelCatalogEntry) {
    const lookupResult = currentTargetLookupResult(targetQuery.data.value, targetInput.value)
    const lookupDenied =
      targetQuery.error.value instanceof ApiQueryError &&
      [403, 404].includes(targetQuery.error.value.status)
    if (!directoryQuery.data.value) return
    if (targetLookupRequired.value && !lookupResult && !lookupDenied) return
    if (contribution) replaceWithContribution(contribution)
    else replaceLocationQuery({})
  }

  function replaceLocationQuery(query: Record<string, string>) {
    if (sameLocationQuery(route.query, query)) return
    void router.replace({ query })
  }

  function currentTargetQueryIdentity(): PlatformReviewerContributionTargetIdentity | undefined {
    const contribution = selectedContribution.value
    const target = selectedTarget.value
    if (!contribution || !target || organizationVersion.value <= 0) return undefined
    return {
      organizationVersion: organizationVersion.value,
      moduleId: contribution.moduleId,
      sectionId: contribution.sectionId,
      contributionId: contribution.contributionId,
      target,
    }
  }

  return {
    authLoading,
    authSession,
    availableContributions,
    corporationText,
    cursorHistory,
    directoryQuery,
    entryError,
    entryQuery,
    limit,
    members,
    nextDirectoryPage,
    organizationVersion,
    panelFocusRequest,
    previousDirectoryPage,
    queryAccess,
    retryDirectory,
    retryEntry,
    runtimeQuery,
    searchText,
    selectContribution,
    selectedContribution,
    selectedMember,
    selectedTarget,
    selectMember,
    submitSearch,
    targetQuery,
  }
}

function currentTargetLookupMember(
  result: OrganizationReviewTargetResult | undefined,
  input: OrganizationReviewTargetInput,
) {
  return currentTargetLookupResult(result, input)?.member ?? undefined
}

function currentTargetLookupResult(
  result: OrganizationReviewTargetResult | undefined,
  input: OrganizationReviewTargetInput,
) {
  if (
    result?.organizationVersion !== input.organizationVersion ||
    result?.targetUserId !== input.targetUserId ||
    result?.targetCharacterId !== input.targetCharacterId ||
    result?.managedMemberLifecycleId !== input.managedMemberLifecycleId
  )
    return undefined
  return result
}

function canonicalQuery(
  member: OrganizationReviewDirectoryMember | OrganizationReviewTargetMember,
  contribution: PlatformReviewerPanelCatalogEntry,
  requestedCharacterId?: number,
) {
  const targetCharacterId = requestedCharacterId ?? member.managedAffiliation.characterId
  return {
    targetUserId: member.account.userId,
    ...(requestedCharacterId !== undefined ||
    contribution.target === 'managed-organization-character'
      ? { targetCharacterId: String(targetCharacterId) }
      : {}),
    contribution: reviewerContributionIdentity(contribution),
  }
}

function sameTargetQueryIdentity(
  left: PlatformReviewerContributionTargetIdentity,
  right: PlatformReviewerContributionTargetIdentity | undefined,
) {
  return right !== undefined && JSON.stringify(left) === JSON.stringify(right)
}

function normalizedSearch(value: string) {
  const normalized = value.trim()
  return normalized || undefined
}

function positiveInteger(value: string) {
  const normalized = value.trim()
  if (!normalized) return undefined
  const number = Number(normalized)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function sameLocationQuery(current: Record<string, unknown>, expected: Record<string, string>) {
  const currentKeys = Object.keys(current)
  const expectedKeys = Object.keys(expected)
  return (
    currentKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => current[key] === expected[key])
  )
}
