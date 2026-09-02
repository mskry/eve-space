import { createContractsClient } from '@evespace/esi-client/domains/contracts'
import type { GetCharactersCharacterIdContractsOutput } from '@evespace/esi-client/schemas'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'
import { financeTypeName, loadFinanceTypeNames } from './finance-type-names.js'

export const characterContractsScope = getCharacterEsiScope('character-contracts')

type EsiCharacterContract = GetCharactersCharacterIdContractsOutput[number]

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

interface CharacterContractsData {
  contracts: CharacterContract[]
  page: number
  totalPages: number
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

interface CharacterContractBidsData {
  bids: Array<{
    bidId: number
    amount: number
    bidAt: string
  }>
}

export type CharacterContractsResult = CharacterContractsData & EsiResultMetadata
export type CharacterContractItemsResult = CharacterContractItemsData & EsiResultMetadata
export type CharacterContractBidsResult = CharacterContractBidsData & EsiResultMetadata

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
    const result = await getEsiResilienceLayer().getCharacter<CharacterContractItemsData>({
      operation: 'character-contract-items',
      inputs: { characterId, contractId },
      load: async (authority, revalidation) => {
        const response = await createContractsClient({
          fetch: createEsiTransport('character-contract-items', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .listCharacterContractItems(characterId, contractId, revalidation)
        const namesByType = await loadFinanceTypeNames(response.data.map((item) => item.type_id))
        return {
          data: {
            items: response.data.map((item) => ({
              recordId: item.record_id,
              typeId: item.type_id,
              typeName: financeTypeName(item.type_id, namesByType),
              direction: item.is_included ? 'included' : 'requested',
              quantity: item.quantity,
              isSingleton: item.is_singleton,
              blueprint: contractItemBlueprint(item.raw_quantity),
            })),
          },
          meta: response.meta,
        }
      },
    })
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
    const result = await getEsiResilienceLayer().getCharacter<CharacterContractBidsData>({
      operation: 'character-contract-bids',
      inputs: { characterId, contractId },
      load: async (authority, revalidation) => {
        const response = await createContractsClient({
          fetch: createEsiTransport('character-contract-bids', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .listCharacterContractBids(characterId, contractId, revalidation)
        return {
          data: {
            bids: response.data.map((bid) => ({
              bidId: bid.bid_id,
              amount: bid.amount,
              bidAt: bid.date_bid,
            })),
          },
          meta: response.meta,
        }
      },
    })
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwContractError(error)
  }
}

async function loadCharacterContracts(characterId: number, page: number) {
  return getEsiResilienceLayer().getCharacter<CharacterContractsData>({
    operation: 'character-contracts',
    inputs: { characterId, page },
    load: async (authority, revalidation) => {
      const response = await createContractsClient({
        fetch: createEsiTransport('character-contracts', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .listCharacterContracts(characterId, { page, ...revalidation })
      return {
        data: {
          contracts: response.data
            .filter((contract) => !contract.for_corporation)
            .map((contract) => ({
              contractId: contract.contract_id,
              type: contract.type,
              status: contract.status,
              availability: contract.availability,
              // Derived, so the counterparty identifiers behind it stay out of the DTO.
              role:
                contract.assignee_id === characterId || contract.acceptor_id === characterId
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
          page,
          totalPages: paginationPages(response.meta.pagination?.pages, page),
        },
        meta: response.meta,
      }
    },
  })
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
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new Error(`${name} must be a positive safe integer`)
}

function throwContractError(error: unknown): never {
  if (error instanceof ContractNotFoundError) throw error
  if (error instanceof EsiQuotaError) throw new ContractQuotaError(error.retryAfterSeconds)
  throw error
}
