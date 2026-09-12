import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdContractsResponse } from '@evespace/esi-client/types'
import {
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { assertFinancePositiveSafeInteger, resolveFinanceTotalPages } from './finance-pagination.js'
import { financeTypeName, loadFinanceTypeNames } from './finance-type-names.js'

type EsiCharacterContract = GetCharactersCharacterIdContractsResponse[number]

interface CharacterContract {
  contractId: number
  type: EsiCharacterContract['type']
  status: EsiCharacterContract['status']
  availability: EsiCharacterContract['availability']
  role: 'assigned' | 'issued'
  title: string | null
  issuedAt: string
  expiredAt: string
  acceptedAt: string | null
  completedAt: string | null
  daysToComplete: number | null
  startLocationId: number | null
  endLocationId: number | null
  price: number | null
  reward: number | null
  collateral: number | null
  buyout: number | null
  volume: number | null
}

interface CharacterContractsRepresentationInput {
  characterId: number
  page: number
  subjectLifecycleId: string
}

interface CharacterContractsData {
  contracts: CharacterContract[]
  page: number
  totalPages: number
}

type CharacterContractsResult = CharacterContractsData & EsiReadResultMetadata

const characterContractsRead = createCharacterEsiRead({
  operation: 'character-contracts',
  name: 'character-contracts-core',
  descriptor: operationRegistry.GetCharactersCharacterIdContracts.transport,
  encodeRequest: (input: CharacterContractsRepresentationInput) => ({
    path: { character_id: input.characterId },
    query: { page: input.page },
  }),
  map: (response, input): CharacterContractsData => ({
    contracts: response.data
      .filter((contract) => !contract.for_corporation)
      .map((contract) => ({
        contractId: contract.contract_id,
        type: contract.type,
        status: contract.status,
        availability: contract.availability,
        // Derived, so the counterparty identifiers behind it stay out of the DTO.
        role:
          contract.assignee_id === input.characterId || contract.acceptor_id === input.characterId
            ? 'assigned'
            : 'issued',
        title: contract.title ?? null,
        issuedAt: contract.date_issued,
        expiredAt: contract.date_expired,
        acceptedAt: contract.date_accepted ?? null,
        completedAt: contract.date_completed ?? null,
        daysToComplete: contract.days_to_complete ?? null,
        startLocationId: contract.start_location_id ?? null,
        endLocationId: contract.end_location_id ?? null,
        price: contract.price ?? null,
        reward: contract.reward ?? null,
        collateral: contract.collateral ?? null,
        buyout: contract.buyout ?? null,
        volume: contract.volume ?? null,
      })),
    page: input.page,
    totalPages: resolveFinanceTotalPages(response.meta.pagination?.pages, input.page),
  }),
})

export const characterContractsScope = characterContractsRead.requiredScope

interface CharacterContractItemsRepresentationInput {
  characterId: number
  contractId: number
  subjectLifecycleId: string
}

interface CharacterContractItemsData {
  items: Array<{
    recordId: number
    typeId: number
    typeName: string
    direction: 'included' | 'requested'
    quantity: number
    isSingleton: boolean
    blueprint: 'original' | 'copy' | null
  }>
}

type CharacterContractItemsResult = CharacterContractItemsData & EsiReadResultMetadata

const characterContractItemsRead = createCharacterEsiRead({
  operation: 'character-contract-items',
  name: 'character-contract-items-core',
  descriptor: operationRegistry.GetCharactersCharacterIdContractsContractIdItems.transport,
  encodeRequest: (input: CharacterContractItemsRepresentationInput) => ({
    path: { character_id: input.characterId, contract_id: input.contractId },
  }),
  map: async (response): Promise<CharacterContractItemsData> => {
    const namesByType = await loadFinanceTypeNames(response.data.map((item) => item.type_id))
    return {
      items: response.data.map((item) => ({
        recordId: item.record_id,
        typeId: item.type_id,
        typeName: financeTypeName(item.type_id, namesByType),
        direction: item.is_included ? 'included' : 'requested',
        quantity: item.quantity,
        isSingleton: item.is_singleton,
        blueprint: contractItemBlueprint(item.raw_quantity),
      })),
    }
  },
})

interface CharacterContractBidsRepresentationInput {
  characterId: number
  contractId: number
  subjectLifecycleId: string
}

interface CharacterContractBidsData {
  bids: Array<{
    bidId: number
    amount: number
    bidAt: string
  }>
}

type CharacterContractBidsResult = CharacterContractBidsData & EsiReadResultMetadata

const characterContractBidsRead = createCharacterEsiRead({
  operation: 'character-contract-bids',
  name: 'character-contract-bids-core',
  descriptor: operationRegistry.GetCharactersCharacterIdContractsContractIdBids.transport,
  encodeRequest: (input: CharacterContractBidsRepresentationInput) => ({
    path: { character_id: input.characterId, contract_id: input.contractId },
  }),
  map: (response): CharacterContractBidsData => ({
    bids: response.data.map((bid) => ({
      bidId: bid.bid_id,
      amount: bid.amount,
      bidAt: bid.date_bid,
    })),
  }),
})

export class ContractNotFoundError extends Error {
  constructor() {
    super('Character contract was not found in the referenced personal contract page')
  }
}

export async function getCharacterContracts(
  characterId: number,
  page: number,
  subjectLifecycleId: string,
): Promise<CharacterContractsResult> {
  assertFinancePositiveSafeInteger(page, 'Character contract page')
  const result = await loadCharacterContracts(characterId, subjectLifecycleId, page)
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

export async function getCharacterContractItems(
  characterId: number,
  contractId: number,
  contractPage: number,
  subjectLifecycleId: string,
): Promise<CharacterContractItemsResult> {
  assertContractDetailInputs(contractId, contractPage)
  await requirePersonalContract(characterId, subjectLifecycleId, contractId, contractPage)
  const result = await characterContractItemsRead.execute({
    characterId,
    contractId,
    subjectLifecycleId,
  })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

export async function getCharacterContractBids(
  characterId: number,
  contractId: number,
  contractPage: number,
  subjectLifecycleId: string,
): Promise<CharacterContractBidsResult> {
  assertContractDetailInputs(contractId, contractPage)
  await requirePersonalContract(characterId, subjectLifecycleId, contractId, contractPage)
  const result = await characterContractBidsRead.execute({
    characterId,
    contractId,
    subjectLifecycleId,
  })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

function loadCharacterContracts(characterId: number, subjectLifecycleId: string, page: number) {
  return characterContractsRead.execute({ characterId, page, subjectLifecycleId })
}

async function requirePersonalContract(
  characterId: number,
  subjectLifecycleId: string,
  contractId: number,
  page: number,
) {
  const parent = await loadCharacterContracts(characterId, subjectLifecycleId, page)
  if (!parent.data.contracts.some((contract) => contract.contractId === contractId))
    throw new ContractNotFoundError()
}

function assertContractDetailInputs(contractId: number, contractPage: number) {
  assertFinancePositiveSafeInteger(contractId, 'Character contract ID')
  assertFinancePositiveSafeInteger(contractPage, 'Character contract page')
}

function contractItemBlueprint(rawQuantity: number | undefined): 'original' | 'copy' | null {
  if (rawQuantity === -1) return 'original'
  if (rawQuantity === -2) return 'copy'
  return null
}
