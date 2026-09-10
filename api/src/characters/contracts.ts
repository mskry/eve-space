import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdContractsResponse } from '@evespace/esi-client/types'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog-access.js'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { defineCharacterEsiRepresentation } from '../esi-resilience/representations.js'
import { toEsiResultMetadata } from '../esi-resilience/result-metadata.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'
import { isPositiveSafeInteger } from '../type-guards.js'
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
}

interface CharacterContractsData {
  contracts: CharacterContract[]
  page: number
  totalPages: number
}

export type CharacterContractsResult = CharacterContractsData & EsiResultMetadata

const characterContractsRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
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
      totalPages: paginationPages(response.meta.pagination?.pages, input.page),
    }),
  }),
)

export const characterContractsScope = getCharacterEsiScope(
  characterContractsRepresentation.operation,
)

interface CharacterContractItemsRepresentationInput {
  characterId: number
  contractId: number
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

export type CharacterContractItemsResult = CharacterContractItemsData & EsiResultMetadata

const characterContractItemsRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
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
  }),
)

interface CharacterContractBidsRepresentationInput {
  characterId: number
  contractId: number
}

interface CharacterContractBidsData {
  bids: Array<{
    bidId: number
    amount: number
    bidAt: string
  }>
}

export type CharacterContractBidsResult = CharacterContractBidsData & EsiResultMetadata

const characterContractBidsRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
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
  }),
)

export class ContractNotFoundError extends Error {
  constructor() {
    super('Character contract was not found in the referenced personal contract page')
  }
}

export class ContractQuotaError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('ESI contract quota is temporarily exhausted')
  }
}

export async function getCharacterContracts(
  characterId: number,
  page: number,
): Promise<CharacterContractsResult> {
  assertPositiveSafeInteger(page, 'Character contract page')
  try {
    const result = await loadCharacterContracts(characterId, page)
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwContractError(error)
  }
}

export async function getCharacterContractItems(
  characterId: number,
  contractId: number,
  contractPage: number,
): Promise<CharacterContractItemsResult> {
  assertContractDetailInputs(contractId, contractPage)
  try {
    await requirePersonalContract(characterId, contractId, contractPage)
    const result = await execute(characterContractItemsRepresentation, { characterId, contractId })
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwContractError(error)
  }
}

export async function getCharacterContractBids(
  characterId: number,
  contractId: number,
  contractPage: number,
): Promise<CharacterContractBidsResult> {
  assertContractDetailInputs(contractId, contractPage)
  try {
    await requirePersonalContract(characterId, contractId, contractPage)
    const result = await execute(characterContractBidsRepresentation, { characterId, contractId })
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwContractError(error)
  }
}

function loadCharacterContracts(characterId: number, page: number) {
  return execute(characterContractsRepresentation, { characterId, page })
}

async function requirePersonalContract(characterId: number, contractId: number, page: number) {
  const parent = await loadCharacterContracts(characterId, page)
  if (!parent.data.contracts.some((contract) => contract.contractId === contractId))
    throw new ContractNotFoundError()
}

function assertContractDetailInputs(contractId: number, contractPage: number) {
  assertPositiveSafeInteger(contractId, 'Character contract ID')
  assertPositiveSafeInteger(contractPage, 'Character contract page')
}

function contractItemBlueprint(rawQuantity: number | undefined): 'original' | 'copy' | null {
  if (rawQuantity === -1) return 'original'
  if (rawQuantity === -2) return 'copy'
  return null
}

function paginationPages(value: number | undefined, page: number) {
  if (value === undefined || value === 0) return page
  assertPositiveSafeInteger(value, 'ESI pagination total')
  return value
}

function assertPositiveSafeInteger(value: unknown, name: string): asserts value is number {
  if (!isPositiveSafeInteger(value)) throw new Error(`${name} must be a positive safe integer`)
}

function throwContractError(error: unknown): never {
  if (error instanceof ContractNotFoundError) throw error
  if (error instanceof EsiQuotaError) throw new ContractQuotaError(error.retryAfterSeconds)
  throw error
}
