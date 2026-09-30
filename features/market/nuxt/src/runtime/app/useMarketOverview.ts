import { useQuery, useQueryCache } from '@pinia/colada'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import { computed, type Ref } from 'vue'
import { eligibleMarketProfiles, selectMarketProfile } from './market-profile-selection'
import { useMarketHistoryRequest } from './useMarketHistoryRequest'

type NumberRef = Readonly<Ref<number>>
type StringRef = Readonly<Ref<string>>
type TypeIdRef = Readonly<Ref<number | null>>
type FlagRef = Readonly<Ref<boolean>>

const useMarketItemQuery = (revision: StringRef, typeId: TypeIdRef) => {
  const api = usePlatformApi()
  const itemQuery = useQuery(() => ({
    key: ['market', 'catalogue', revision.value, 'type', typeId.value],
    enabled: Boolean(revision.value && typeId.value),
    staleTime: Infinity,
    query: async ({ signal }) => {
      const requestedRevision = revision.value
      const requestedTypeId = typeId.value!
      const response = await api.api.modules.market.catalogue.body[':revision'].types[
        ':typeId'
      ].$get(
        {
          param: {
            revision: requestedRevision,
            typeId: String(requestedTypeId),
          },
        },
        { init: { signal } },
      )
      if (response.status === 404) return { requestedRevision, requestedTypeId, item: null }
      const result = await readPlatformApiResponse(response, 'Market item is unavailable.')
      if (result.kind !== 'type-by-id') throw new Error('Market item lookup is invalid')
      return { requestedRevision, requestedTypeId, item: result.item }
    },
  }))
  const item = computed(() => {
    const result = itemQuery.data.value
    return result?.requestedRevision === revision.value && result.requestedTypeId === typeId.value
      ? result.item
      : null
  })
  return { item, itemQuery }
}

const useMarketProfiles = (typeId: TypeIdRef, requestedProfileId: StringRef) => {
  const api = usePlatformApi()
  const profilesQuery = useQuery({
    key: ['market', 'public-profiles'],
    staleTime: 30_000,
    query: async ({ signal }) =>
      readPlatformApiResponse(
        await api.api.modules.market.books.profiles.$get({}, { init: { signal } }),
        'Public markets are unavailable.',
      ),
  })
  const profiles = computed(() => profilesQuery.data.value?.profiles ?? [])
  const eligibleProfiles = computed(() => eligibleMarketProfiles(profiles.value, typeId.value))
  const profile = computed(() =>
    selectMarketProfile(eligibleProfiles.value, requestedProfileId.value),
  )
  const profileId = computed(() => profile.value?.profileId ?? '')
  const profileRevision = computed(() => profile.value?.revision ?? 0)
  return {
    profiles,
    eligibleProfiles,
    profilesQuery,
    profile,
    profileId,
    profileRevision,
  }
}

const useMarketBookQuery = (
  profileId: StringRef,
  profileRevision: NumberRef,
  typeId: TypeIdRef,
  historyActive: FlagRef,
) => {
  const api = usePlatformApi()
  const bookQuery = useQuery(() => ({
    key: ['market', 'book', profileId.value, profileRevision.value, typeId.value],
    enabled: Boolean(profileId.value && typeId.value) && !historyActive.value,
    staleTime: 10_000,
    query: async ({ signal }) => {
      const selectedProfile = profileId.value
      const selectedType = typeId.value!
      const result = await readPlatformApiResponse(
        await api.api.modules.market.books.profiles[':profileId'].types[':typeId'].observation.$get(
          {
            param: { profileId: selectedProfile, typeId: String(selectedType) },
          },
          { init: { signal } },
        ),
        'Market order book is unavailable.',
      )
      return { profileId: selectedProfile, typeId: selectedType, result }
    },
  }))
  const book = computed(() => {
    const current = bookQuery.data.value
    return current?.profileId === profileId.value && current.typeId === typeId.value
      ? current.result
      : null
  })
  return { book, bookQuery }
}

const useMarketHistoryQuery = (
  profileId: StringRef,
  profileRevision: NumberRef,
  typeId: TypeIdRef,
  historyActive: FlagRef,
) => {
  const api = usePlatformApi()
  const historyQuery = useQuery(() => ({
    key: ['market', 'history', profileId.value, profileRevision.value, typeId.value],
    enabled: Boolean(profileId.value && typeId.value) && historyActive.value,
    staleTime: 60_000,
    query: async ({ signal }) => {
      const selectedProfile = profileId.value
      const selectedType = typeId.value!
      const result = await readPlatformApiResponse(
        await api.api.modules.market.history.profiles[':profileId'].types[':typeId'].$get(
          {
            param: { profileId: selectedProfile, typeId: String(selectedType) },
          },
          { init: { signal } },
        ),
        'Market price history is unavailable.',
      )
      return { profileId: selectedProfile, typeId: selectedType, result }
    },
  }))
  const history = computed(() => {
    const current = historyQuery.data.value
    return current?.profileId === profileId.value && current.typeId === typeId.value
      ? current.result
      : null
  })
  return { history, historyQuery }
}

type HistoryProfile = {
  readonly mode: string
  readonly watchedTypeIds: readonly number[]
}

const historyOnDemand = (profile: HistoryProfile | null | undefined, typeId: number | null) =>
  profile?.mode === 'region' ||
  (typeId !== null && profile?.mode === 'watched-types' && profile.watchedTypeIds.includes(typeId))

export const useMarketOverview = (
  revision: StringRef,
  typeId: TypeIdRef,
  requestedProfileId: StringRef,
  historyActive: FlagRef,
) => {
  const queryCache = useQueryCache()
  const { item, itemQuery } = useMarketItemQuery(revision, typeId)
  const { profiles, eligibleProfiles, profilesQuery, profile, profileId, profileRevision } =
    useMarketProfiles(typeId, requestedProfileId)
  const { book, bookQuery } = useMarketBookQuery(profileId, profileRevision, typeId, historyActive)
  const { history, historyQuery } = useMarketHistoryQuery(
    profileId,
    profileRevision,
    typeId,
    historyActive,
  )
  const { status: historyRequest, retry: retryHistoryRequest } = useMarketHistoryRequest({
    target: computed(() => ({
      profileId: profileId.value,
      profileRevision: profileRevision.value,
      typeId: typeId.value,
      onDemand: historyOnDemand(profile.value, typeId.value),
    })),
    active: historyActive,
    onReady: (result) => {
      const key = ['market', 'history', profileId.value, profileRevision.value, typeId.value]
      queryCache.cancelQueries({ key, exact: true })
      queryCache.setQueryData(key, {
        profileId: profileId.value,
        typeId: typeId.value!,
        result,
      })
    },
    uncollected: computed(() => !history.value || history.value.freshness !== 'current'),
    refetch: async () => {
      await historyQuery.refetch()
    },
  })
  return {
    item,
    itemQuery,
    profiles,
    eligibleProfiles,
    profilesQuery,
    profile,
    book,
    bookQuery,
    history,
    historyQuery,
    historyRequest,
    retryHistoryRequest,
  }
}

export type MarketBook = NonNullable<ReturnType<typeof useMarketOverview>['book']['value']>
export type MarketObservedBook = Extract<MarketBook, { status: 'current' | 'stale' }>
export type MarketDailyHistory = NonNullable<
  ReturnType<typeof useMarketOverview>['history']['value']
>
