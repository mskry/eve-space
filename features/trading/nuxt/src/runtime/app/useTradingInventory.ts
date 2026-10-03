import { ref, watch } from 'vue'
import {
  toGraphQLFieldError,
  usePlatformIdentity,
  type ApplicationGraphQLResult,
  type PlatformInventorySelection,
} from '@eve-space/platform-module-nuxt/runtime'
import {
  TradingPersonalInventoryDocument,
  TradingCorporationInventoryDocument,
  TradingPersonalCoverageDocument,
  TradingCorporationCoverageDocument,
  TradingPersonalHoldersDocument,
  TradingCorporationHoldersDocument,
  type TradingInventoryStatusFragment,
  type TradingInventoryGroupsFragment,
  type TradingPersonalCoverageQuery,
  type TradingPersonalHoldersQuery,
  type TradingInventoryFilters,
} from './trading-graphql'
import { assertSameInventoryView } from './inventory-presentation'

type Coverage = NonNullable<
  NonNullable<TradingPersonalCoverageQuery['trading']>['personalInventory']
>['coverage']
type Holders = NonNullable<
  NonNullable<TradingPersonalHoldersQuery['trading']>['personalInventory']
>['holders']
interface InventoryView {
  readonly status: TradingInventoryStatusFragment
  readonly groups: TradingInventoryGroupsFragment
  readonly coverage: Coverage
  readonly holders?: Holders
  readonly holderLabel?: string
}

const requireValue = <Value>(result: ApplicationGraphQLResult<Value>) => {
  if (result.errors?.length) throw toGraphQLFieldError(result.errors[0]!)
  if (!result.data) throw new Error('Inventory response unavailable.')
  return result.data
}

export const useTradingInventory = () => {
  const identity = usePlatformIdentity()
  const execute = usePlatformGraphQL()
  const selection = ref<PlatformInventorySelection>({ scope: 'personal' })
  const filters = ref<TradingInventoryFilters>({
    typeId: undefined,
    groupId: undefined,
    categoryId: undefined,
    locationKey: undefined,
  })
  const corporations = usePlatformInventoryCorporations()
  const scopeVariables = () => ({
    characterIds:
      selection.value.scope === 'personal' ? selection.value.characterIds?.map(String) : undefined,
  })
  const groups = async (signal: AbortSignal, after?: string) => {
    const variables = { ...scopeVariables(), filters: filters.value, first: 50, after }
    const result =
      selection.value.scope === 'personal'
        ? requireValue(await execute(TradingPersonalInventoryDocument, variables, signal)).trading
            ?.personalInventory
        : requireValue(
            await execute(
              TradingCorporationInventoryDocument,
              { ...variables, corporationId: String(selection.value.corporationId) },
              signal,
            ),
          ).trading?.corporationInventory
    if (!result) throw new Error('Inventory module unavailable.')
    return result
  }
  const coverage = async (signal: AbortSignal, after?: string) => {
    const variables = { ...scopeVariables(), first: 50, after }
    const result =
      selection.value.scope === 'personal'
        ? requireValue(await execute(TradingPersonalCoverageDocument, variables, signal)).trading
            ?.personalInventory
        : requireValue(
            await execute(
              TradingCorporationCoverageDocument,
              { ...variables, corporationId: String(selection.value.corporationId) },
              signal,
            ),
          ).trading?.corporationInventory
    if (!result) throw new Error('Inventory module unavailable.')
    return result
  }
  const load = async (signal: AbortSignal): Promise<InventoryView> => {
    const [inventory, sources] = await Promise.all([groups(signal), coverage(signal)])
    assertSameInventoryView(inventory, sources)
    return { status: inventory, groups: inventory.groups, coverage: sources.coverage }
  }
  const query = usePlatformInventoryQuery<InventoryView>(() => ({
    selection: selection.value,
    resource: JSON.stringify(filters.value),
    load,
  }))
  watch(
    query.status,
    (status) => {
      if (status === 'denied' && selection.value.scope === 'corporation') corporations.value = []
    },
    { flush: 'sync' },
  )
  const nextGroups = () => {
    const previous = query.data.value
    if (!previous?.groups.endCursor) return
    void query.execute(async (signal) => {
      const value = await groups(signal, previous.groups.endCursor!)
      assertSameInventoryView(previous.status, value)
      return { ...previous, status: value, groups: value.groups, holders: undefined }
    })
  }
  const nextCoverage = () => {
    const previous = query.data.value
    if (!previous?.coverage.endCursor) return
    void query.execute(async (signal) => {
      const value = await coverage(signal, previous.coverage.endCursor!)
      assertSameInventoryView(previous.status, value)
      return { ...previous, coverage: value.coverage }
    })
  }
  const showHolders = (groupKey: string, label: string, after?: string) => {
    const previous = query.data.value
    if (!previous) return
    void query.execute(async (signal) => {
      const variables = { ...scopeVariables(), groupKey, first: 50, after }
      const value =
        selection.value.scope === 'personal'
          ? requireValue(await execute(TradingPersonalHoldersDocument, variables, signal)).trading
              ?.personalInventory
          : requireValue(
              await execute(
                TradingCorporationHoldersDocument,
                { ...variables, corporationId: String(selection.value.corporationId) },
                signal,
              ),
            ).trading?.corporationInventory
      if (!value) throw new Error('Inventory holders unavailable.')
      assertSameInventoryView(previous.status, value)
      return { ...previous, holders: value.holders, holderLabel: label }
    })
  }
  return {
    ...query,
    selection,
    filters,
    corporations,
    characters: identity.characters,
    nextGroups,
    nextCoverage,
    showHolders,
  }
}
