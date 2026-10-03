import { useQueryCache } from '@pinia/colada'
import { computed, type Ref } from 'vue'
import { useMarketHistoryRequest } from './useMarketHistoryRequest'
import {
  type MarketHistoryResource,
  marketSelection,
  useMarketItemQuery,
  useMarketProfiles,
  useMarketHistoryQuery,
} from './useMarketReadQueries'
import { useMarketOrderBook } from './useMarketOrderBook'

type StringRef = Readonly<Ref<string>>
type TypeIdRef = Readonly<Ref<number | null>>
type FlagRef = Readonly<Ref<boolean>>
type HistoryProfile = { readonly mode: string; readonly watchedTypeIds: readonly number[] }

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
  const refs = { profileId, profileRevision, typeId, historyActive }
  const orders = useMarketOrderBook(refs)
  const { history, historyQuery, historyKey } = useMarketHistoryQuery(refs)
  const { status: historyRequest, retry: retryHistoryRequest } = useMarketHistoryRequest({
    target: computed(() => ({
      profileId: profileId.value,
      profileRevision: profileRevision.value,
      typeId: typeId.value,
      onDemand: historyOnDemand(profile.value, typeId.value),
    })),
    active: historyActive,
    onReady: (result) => {
      if (result.typeId !== typeId.value || result.regionId !== profile.value?.regionId) return
      const key = historyKey.value
      queryCache.cancelQueries({ key, exact: true })
      queryCache.setQueryData<MarketHistoryResource>(key, {
        selected: marketSelection(refs),
        result,
        provenance: 'history-demand',
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
    orders,
    history,
    historyQuery,
    historyRequest,
    retryHistoryRequest,
  }
}
