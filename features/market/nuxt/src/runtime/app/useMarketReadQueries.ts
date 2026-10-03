import { ApiQueryError } from '@eve-space/platform-module-nuxt/runtime'
import { useQuery, useQueryCache } from '@pinia/colada'
import { computed, type Ref } from 'vue'
import {
  MarketItemDocument,
  MarketProfilesDocument,
  MarketBookDocument,
  MarketHistoryDocument,
} from './market-graphql'
import {
  adaptMarketItem,
  adaptMarketProfiles,
  adaptMarketBook,
  adaptMarketHistory,
  marketField,
} from './market-graphql-adapters'
import {
  marketGraphQLKey,
  marketQueryOptions,
  marketRelease,
  marketSourceStaleTime,
} from './market-query-options'
import type { MarketBookDiscovery, MarketDailyHistory } from './market-models'
import { marketSafeInteger } from './market-graphql-values'
import { eligibleMarketProfiles, selectMarketProfile } from './market-profile-selection'

export interface MarketSelectionRefs {
  readonly profileId: Readonly<Ref<string>>
  readonly profileRevision: Readonly<Ref<number>>
  readonly typeId: Readonly<Ref<number | null>>
  readonly historyActive: Readonly<Ref<boolean>>
}

export interface MarketHistoryResource {
  readonly selected: ReturnType<typeof marketSelection>
  readonly result: MarketDailyHistory
  readonly provenance: 'graphql' | 'history-demand'
}

interface MarketBookResource {
  readonly selected: ReturnType<typeof marketSelection>
  readonly book: MarketBookDiscovery
}

export const marketSelection = ({ profileId, profileRevision, typeId }: MarketSelectionRefs) =>
  [profileId.value, profileRevision.value, typeId.value] as const

export const useMarketItemQuery = (
  revision: Readonly<Ref<string>>,
  typeId: Readonly<Ref<number | null>>,
) => {
  const execute = usePlatformGraphQL()
  const itemQuery = useQuery(() => {
    const selected = [revision.value, typeId.value] as const
    return marketQueryOptions(
      marketGraphQLKey('MarketItem', selected),
      Boolean(selected[0] && selected[1]),
      Infinity,
      async ({ signal }) => {
        const envelope = await execute(
          MarketItemDocument,
          { revision: selected[0], typeId: String(selected[1]) },
          signal,
        )
        marketRelease(signal, selected, [revision.value, typeId.value])
        let field
        try {
          field = marketField(
            envelope,
            ['market', 'catalogueType'],
            envelope.data?.market?.catalogueType,
          )
        } catch (error) {
          if (error instanceof ApiQueryError && error.code === 'MARKET_TYPE_UNAVAILABLE')
            return { selected, item: null }
          throw error
        }
        const result = adaptMarketItem(field)
        marketRelease(signal, selected, [result.revision, result.item.id])
        return { selected, item: result.item }
      },
    )
  })
  const item = computed(() => {
    const result = itemQuery.data.value
    return result?.selected[0] === revision.value && result.selected[1] === typeId.value
      ? result.item
      : null
  })
  return { item, itemQuery }
}

export const useMarketProfiles = (
  typeId: Readonly<Ref<number | null>>,
  requestedProfileId: Readonly<Ref<string>>,
) => {
  const execute = usePlatformGraphQL()
  const profilesQuery = useQuery(
    marketQueryOptions(marketGraphQLKey('MarketProfiles', []), true, 30_000, async ({ signal }) => {
      const result = await execute(MarketProfilesDocument, {}, signal)
      return adaptMarketProfiles(
        marketField(result, ['market', 'profiles'], result.data?.market?.profiles),
      )
    }),
  )
  const profiles = computed(() => profilesQuery.data.value ?? [])
  const eligibleProfiles = computed(() => eligibleMarketProfiles(profiles.value, typeId.value))
  const profile = computed(() =>
    selectMarketProfile(eligibleProfiles.value, requestedProfileId.value),
  )
  return {
    profiles,
    profilesQuery,
    eligibleProfiles,
    profile,
    profileId: computed(() => profile.value?.profileId ?? ''),
    profileRevision: computed(() => profile.value?.revision ?? 0),
  }
}

export const useMarketBookQuery = (refs: MarketSelectionRefs) => {
  const execute = usePlatformGraphQL()
  const queryCache = useQueryCache()
  const bookQuery = useQuery(() => {
    const selected = marketSelection(refs)
    const key = marketGraphQLKey('MarketBook', selected)
    const previous = queryCache.getQueryData<MarketBookResource>(key)
    const staleTime = marketSourceStaleTime(
      queryCache,
      key,
      10_000,
      previous?.book.observation?.freshUntil,
    )
    return marketQueryOptions(
      key,
      Boolean(selected[0] && selected[2]) && !refs.historyActive.value,
      staleTime,
      async ({ signal }): Promise<MarketBookResource> => {
        const result = await execute(
          MarketBookDocument,
          { profileId: selected[0], typeId: String(selected[2]) },
          signal,
        )
        marketRelease(signal, selected, marketSelection(refs))
        const book = adaptMarketBook(
          marketField(result, ['market', 'book'], result.data?.market?.book),
        )
        marketRelease(signal, selected, [book.profileId, book.profileRevision, book.typeId])
        if (book.observation)
          marketRelease(
            signal,
            [selected[0], selected[2]],
            [book.observation.profileId, book.observation.typeId],
          )
        return { selected, book }
      },
    )
  })
  const bookState = computed(() => {
    const value = bookQuery.data.value
    return value && JSON.stringify(value.selected) === JSON.stringify(marketSelection(refs))
      ? value.book
      : null
  })
  return { bookState, bookQuery }
}

export const useMarketHistoryQuery = (refs: MarketSelectionRefs) => {
  const execute = usePlatformGraphQL()
  const queryCache = useQueryCache()
  const historyKey = computed(() => marketGraphQLKey('MarketHistory', marketSelection(refs)))
  const historyQuery = useQuery(() => {
    const selected = marketSelection(refs)
    const previous = queryCache.getQueryData<MarketHistoryResource>(historyKey.value)
    const staleTime = marketSourceStaleTime(
      queryCache,
      historyKey.value,
      60_000,
      previous?.result.freshUntil,
    )
    return marketQueryOptions(
      historyKey.value,
      Boolean(selected[0] && selected[2]) && refs.historyActive.value,
      staleTime,
      async ({ signal }): Promise<MarketHistoryResource> => {
        const result = await execute(
          MarketHistoryDocument,
          { profileId: selected[0], typeId: String(selected[2]) },
          signal,
        )
        marketRelease(signal, selected, marketSelection(refs))
        const wire = marketField(result, ['market', 'history'], result.data?.market?.history)
        marketRelease(signal, selected, [
          wire.profileId,
          marketSafeInteger(wire.profileRevision),
          marketSafeInteger(wire.typeId),
        ])
        return {
          selected,
          result: adaptMarketHistory(wire),
          provenance: 'graphql',
        }
      },
    )
  })
  const history = computed(() => {
    const value = historyQuery.data.value
    return value && JSON.stringify(value.selected) === JSON.stringify(marketSelection(refs))
      ? value.result
      : null
  })
  return { history, historyQuery, historyKey }
}
