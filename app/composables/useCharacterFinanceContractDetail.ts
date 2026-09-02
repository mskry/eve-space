import { useQuery, useQueryCache } from '@pinia/colada'
import { computed, nextTick, readonly, ref, watch, type Ref } from 'vue'
import {
  canRunCharacterFinanceQuery,
  characterFinanceContractBidsQuery,
  characterFinanceContractItemsQuery,
  type CharacterFinanceAccess,
} from '../queries/finance'
import type { FinanceContracts } from '../types/finance'
import type { ApiClient } from '../utils/api-client'
import {
  mapCharacterFinanceContractBids,
  mapCharacterFinanceContractItems,
  mapCharacterFinanceResourceState,
} from '../utils/character-finance-mappers'
import { financeContractHasItems } from '../utils/finance'
import type { CharacterFinancePageResource } from './useCharacterFinanceServices'

interface CharacterFinanceContractDetailOptions {
  apiClient: ApiClient
  characterId: Readonly<Ref<number | undefined>>
  contractPage: Readonly<Ref<number>>
  contracts: Readonly<Ref<FinanceContracts | undefined>>
  financeAccess: Readonly<Ref<CharacterFinanceAccess>>
  changePage: (resource: CharacterFinancePageResource, nextPage: number) => boolean
  refreshRequestedServices: () => Promise<unknown>
}

export function useCharacterFinanceContractDetail(options: CharacterFinanceContractDetailOptions) {
  const queryCache = useQueryCache()
  const selectedContractId = ref<number>()
  const contractTrigger = ref<HTMLElement>()
  const requestedItemPages = ref(new Map<number, number>())
  const requestedBidPages = ref(new Map<number, number>())

  const selectedContract = computed(() =>
    options.contracts.value?.contracts.find(
      (contract) => contract.contractId === selectedContractId.value,
    ),
  )
  const contractDrawerOpen = computed({
    get: () => selectedContract.value !== undefined,
    set: (open: boolean) => {
      if (!open) closeContractDrawer()
    },
  })
  const selectedContractItemsRequested = computed(() => {
    const contract = selectedContract.value
    return (
      contract !== undefined &&
      financeContractHasItems(contract.type) &&
      requestedItemPages.value.get(contract.contractId) === options.contractPage.value
    )
  })
  const selectedContractBidsRequested = computed(() => {
    const contract = selectedContract.value
    return (
      contract?.type === 'auction' &&
      requestedBidPages.value.get(contract.contractId) === options.contractPage.value
    )
  })

  const contractItemsQuery = useQuery(() =>
    characterFinanceContractItemsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: options.financeAccess.value,
      requested: selectedContractItemsRequested.value,
      contractId: selectedContractId.value ?? 0,
      contractPage: options.contractPage.value,
    }),
  )
  const contractBidsQuery = useQuery(() =>
    characterFinanceContractBidsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: options.financeAccess.value,
      requested: selectedContractBidsRequested.value,
      contractId: selectedContractId.value ?? 0,
      contractPage: options.contractPage.value,
    }),
  )

  const contractItems = computed(() => {
    const response = contractItemsQuery.data.value
    return response ? mapCharacterFinanceContractItems(response) : undefined
  })
  const contractBids = computed(() => {
    const response = contractBidsQuery.data.value
    return response ? mapCharacterFinanceContractBids(response) : undefined
  })
  const contractItemsState = computed(() =>
    mapCharacterFinanceResourceState({
      data: contractItems.value,
      error: contractItemsQuery.error.value,
      loading: contractItemsQuery.asyncStatus.value === 'loading',
    }),
  )
  const contractBidsState = computed(() =>
    mapCharacterFinanceResourceState({
      data: contractBids.value,
      error: contractBidsQuery.error.value,
      loading: contractBidsQuery.asyncStatus.value === 'loading',
    }),
  )
  const openedItemDetails = computed(() =>
    [...requestedItemPages.value].map(([contractId, contractPage]) => ({
      contractId,
      contractPage,
    })),
  )
  const openedBidDetails = computed(() =>
    [...requestedBidPages.value].map(([contractId, contractPage]) => ({
      contractId,
      contractPage,
    })),
  )

  function openContractDrawer(contractId: number, trigger?: HTMLElement | null) {
    const contract = options.contracts.value?.contracts.find(
      (candidate) => candidate.contractId === contractId,
    )
    if (!contract) return false
    contractTrigger.value = trigger ?? undefined
    selectedContractId.value = contractId
    if (financeContractHasItems(contract.type)) {
      requestedItemPages.value = new Map(requestedItemPages.value).set(
        contractId,
        options.contractPage.value,
      )
    }
    if (contract.type === 'auction') {
      requestedBidPages.value = new Map(requestedBidPages.value).set(
        contractId,
        options.contractPage.value,
      )
    }
    return true
  }

  function closeContractDrawer(restoreFocus = true) {
    const trigger = contractTrigger.value
    selectedContractId.value = undefined
    contractTrigger.value = undefined
    if (restoreFocus && trigger?.isConnected) {
      void nextTick(() => {
        if (trigger.isConnected) trigger.focus()
      })
    }
  }

  function changeContractPage(nextPage: number) {
    if (
      !Number.isSafeInteger(nextPage) ||
      nextPage < 1 ||
      nextPage === options.contractPage.value
    ) {
      return false
    }
    closeContractDrawer(false)
    return options.changePage('contracts', nextPage)
  }

  function refreshOpenedDetails() {
    const characterId = options.characterId.value ?? 0
    if (!canRunCharacterFinanceQuery(options.financeAccess.value, characterId)) {
      return Promise.resolve([])
    }
    const refreshes: Promise<unknown>[] = []
    for (const { contractId, contractPage } of openedItemDetails.value) {
      const query = characterFinanceContractItemsQuery({
        apiClient: options.apiClient,
        characterId,
        access: options.financeAccess.value,
        requested: true,
        contractId,
        contractPage,
      })
      refreshes.push(queryCache.fetch(queryCache.ensure(query)))
    }
    for (const { contractId, contractPage } of openedBidDetails.value) {
      const query = characterFinanceContractBidsQuery({
        apiClient: options.apiClient,
        characterId,
        access: options.financeAccess.value,
        requested: true,
        contractId,
        contractPage,
      })
      refreshes.push(queryCache.fetch(queryCache.ensure(query)))
    }
    return Promise.all(refreshes)
  }

  function refreshRequestedFinance() {
    return Promise.all([options.refreshRequestedServices(), refreshOpenedDetails()])
  }

  watch(
    options.contractPage,
    () => {
      if (selectedContractId.value !== undefined) closeContractDrawer(false)
    },
    { flush: 'sync' },
  )
  watch(
    options.characterId,
    () => {
      closeContractDrawer(false)
      requestedItemPages.value = new Map()
      requestedBidPages.value = new Map()
    },
    { flush: 'sync' },
  )

  return {
    changeContractPage,
    closeContractDrawer,
    contractBids,
    contractBidsQuery,
    contractBidsState,
    contractDrawerOpen,
    contractItems,
    contractItemsQuery,
    contractItemsState,
    openedBidDetails,
    openedItemDetails,
    openContractDrawer,
    refreshOpenedDetails,
    refreshRequestedFinance,
    selectedContract,
    selectedContractBidsRequested,
    selectedContractId: readonly(selectedContractId),
    selectedContractItemsRequested,
  }
}
