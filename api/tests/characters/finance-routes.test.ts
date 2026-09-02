import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ContractNotFoundError extends Error {}
  class ContractQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('Contract quota exhausted')
    }
  }
  class MarketQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('Market quota exhausted')
    }
  }
  class ScopeRequiredError extends Error {
    constructor(readonly scope: string) {
      super(`Missing ${scope}`)
    }
  }
  class TokenRefreshUnavailableError extends Error {}
  class WalletQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('Wallet quota exhausted')
    }
  }

  return {
    ContractNotFoundError,
    ContractQuotaError,
    MarketQuotaError,
    ScopeRequiredError,
    TokenRefreshUnavailableError,
    WalletQuotaError,
    deleteCharacter: vi.fn(),
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    getCharacterContractBids: vi.fn(),
    getCharacterContractItems: vi.fn(),
    getCharacterContracts: vi.fn(),
    getCharacterEmploymentHistory: vi.fn(),
    getCharacterLocation: vi.fn(),
    getCharacterMarketOrderHistory: vi.fn(),
    getCharacterMarketOrders: vi.fn(),
    getCharacterProfile: vi.fn(),
    getCharacterShip: vi.fn(),
    getCharacterSkills: vi.fn(),
    getCharacterSkillsSummary: vi.fn(),
    getWalletBalance: vi.fn(),
    getWalletJournal: vi.fn(),
    getWalletTransactions: vi.fn(),
    listUserCharacters: vi.fn(),
    setMainCharacter: vi.fn(),
  }
})

vi.mock('../../src/auth/store.js', () => ({
  CharacterTokenNotFoundError: class CharacterTokenNotFoundError extends Error {},
  deleteCharacter: mocks.deleteCharacter,
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
  listUserCharacters: mocks.listUserCharacters,
  setMainCharacter: mocks.setMainCharacter,
}))

vi.mock('../../src/env.js', () => ({
  env: {
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  },
}))

vi.mock('../../src/auth/tokens.js', () => ({
  ScopeRequiredError: mocks.ScopeRequiredError,
  TokenRefreshUnavailableError: mocks.TokenRefreshUnavailableError,
}))

vi.mock('../../src/characters/attributes.js', () => ({
  characterAttributesScope: 'esi-skills.read_skills.v1',
  getCharacterAttributes: vi.fn(),
}))

vi.mock('../../src/characters/contracts.js', () => ({
  characterContractsScope: 'esi-contracts.read_character_contracts.v1',
  ContractNotFoundError: mocks.ContractNotFoundError,
  ContractQuotaError: mocks.ContractQuotaError,
  getCharacterContractBids: mocks.getCharacterContractBids,
  getCharacterContractItems: mocks.getCharacterContractItems,
  getCharacterContracts: mocks.getCharacterContracts,
}))

vi.mock('../../src/characters/history.js', () => ({
  getCharacterEmploymentHistory: mocks.getCharacterEmploymentHistory,
}))

vi.mock('../../src/characters/market.js', () => ({
  getCharacterMarketOrderHistory: mocks.getCharacterMarketOrderHistory,
  getCharacterMarketOrders: mocks.getCharacterMarketOrders,
  MarketQuotaError: mocks.MarketQuotaError,
  marketOrdersScope: 'esi-markets.read_character_orders.v1',
}))

vi.mock('../../src/characters/overview.js', () => ({
  getCharacterLocation: mocks.getCharacterLocation,
  getCharacterShip: mocks.getCharacterShip,
  getCharacterSkillsSummary: mocks.getCharacterSkillsSummary,
  locationScope: 'esi-location.read_location.v1',
  shipScope: 'esi-location.read_ship_type.v1',
  skillsScope: 'esi-skills.read_skills.v1',
}))

vi.mock('../../src/characters/profile.js', () => ({
  getCharacterProfile: mocks.getCharacterProfile,
}))

vi.mock('../../src/characters/skill-queue.js', () => ({
  characterSkillQueueScope: 'esi-skills.read_skillqueue.v1',
  getCharacterSkillQueue: vi.fn(),
}))

vi.mock('../../src/characters/skills.js', () => ({
  characterSkillsScope: 'esi-skills.read_skills.v1',
  getCharacterSkills: mocks.getCharacterSkills,
}))

vi.mock('../../src/characters/wallet.js', () => ({
  getWalletBalance: mocks.getWalletBalance,
  getWalletJournal: mocks.getWalletJournal,
  getWalletTransactions: mocks.getWalletTransactions,
  walletScope: 'esi-wallet.read_character_wallet.v1',
  WalletQuotaError: mocks.WalletQuotaError,
}))

import { ScopeRequiredError, TokenRefreshUnavailableError } from '../../src/auth/tokens.js'
import { ContractNotFoundError, ContractQuotaError } from '../../src/characters/contracts.js'
import { MarketQuotaError } from '../../src/characters/market.js'
import { characterRoutes } from '../../src/characters/routes.js'
import { WalletQuotaError } from '../../src/characters/wallet.js'
import { app } from '../../src/index.js'

const characterId = 90_000_001
const contractId = 7_001
const sessionHeaders = { Cookie: 'eve_space_session=active-session' }
const mountedHeaders = { ...sessionHeaders, Origin: 'http://localhost:3000' }
const session = {
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
  mainCharacter: {
    characterId: 90_000_099,
    name: 'Main Pilot',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
  },
}
const ownedCharacter = {
  characterId,
  name: 'Finance Alt',
  corporationId: 98_000_001,
  allianceId: null,
  isMain: false,
  subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
}
const freshness = {
  cachedUntil: '2026-09-02T12:05:00.000Z',
  validatedAt: '2026-09-02T12:00:00.000Z',
  stale: false,
}
const walletBalance = { balance: 1_234_567.89, ...freshness }
const walletJournal = {
  entries: [
    {
      journalId: 101,
      date: '2026-09-02T11:00:00.000Z',
      amount: null,
      balance: null,
      referenceType: 'market_transaction',
      description: 'Market transaction',
      reason: null,
      taxAmount: 2.5,
      context: { id: 88, type: 'market_transaction_id' },
    },
  ],
  page: 2,
  totalPages: 4,
  ...freshness,
}
const walletTransactions = {
  transactions: [
    {
      transactionId: 501,
      journalRefId: 101,
      date: '2026-09-02T11:00:00.000Z',
      typeId: 34,
      typeName: 'Tritanium',
      quantity: 5,
      unitPrice: 10,
      totalPrice: 50,
      isBuy: true,
      locationId: 60_000_001,
    },
  ],
  fromId: 600,
  nextFromId: 501,
  ...freshness,
}
const marketOrders = {
  orders: [
    {
      orderId: 201,
      typeId: 35,
      typeName: 'Pyerite',
      isBuy: false,
      price: 12,
      volumeRemain: 10,
      volumeTotal: 20,
      minimumVolume: null,
      escrow: null,
      range: 'station',
      locationId: 60_000_001,
      regionId: 10_000_002,
      issuedAt: '2026-09-01T10:00:00.000Z',
      durationDays: 30,
      expiresAt: '2026-10-01T10:00:00.000Z',
    },
  ],
  ...freshness,
}
const marketOrderHistory = {
  orders: [{ ...marketOrders.orders[0], state: 'expired' }],
  page: 3,
  totalPages: 6,
  ...freshness,
}
const contracts = {
  contracts: [
    {
      contractId,
      type: 'auction',
      status: 'outstanding',
      availability: 'personal',
      title: null,
      issuedAt: '2026-09-01T10:00:00.000Z',
      expiredAt: '2026-09-08T10:00:00.000Z',
      acceptedAt: null,
      completedAt: null,
      daysToComplete: null,
      startLocationId: 60_000_001,
      endLocationId: null,
      price: null,
      reward: null,
      collateral: 100,
      buyout: 200,
      volume: 5,
    },
  ],
  page: 4,
  totalPages: 7,
  ...freshness,
}
const contractItems = {
  items: [
    {
      recordId: 301,
      typeId: 36,
      typeName: 'Mexallon',
      direction: 'included',
      quantity: 1,
      isSingleton: true,
      blueprint: 'copy',
    },
  ],
  ...freshness,
}
const contractBids = {
  bids: [{ bidId: 401, amount: 250, bidAt: '2026-09-02T11:30:00.000Z' }],
  ...freshness,
}

beforeEach(() => {
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(ownedCharacter)
  mocks.getWalletBalance.mockResolvedValue(walletBalance)
  mocks.getWalletJournal.mockResolvedValue(walletJournal)
  mocks.getWalletTransactions.mockResolvedValue(walletTransactions)
  mocks.getCharacterMarketOrders.mockResolvedValue(marketOrders)
  mocks.getCharacterMarketOrderHistory.mockResolvedValue(marketOrderHistory)
  mocks.getCharacterContracts.mockResolvedValue(contracts)
  mocks.getCharacterContractItems.mockResolvedValue(contractItems)
  mocks.getCharacterContractBids.mockResolvedValue(contractBids)
})

describe('owned-character Finance route successes', () => {
  test.each(successCases())(
    '$name returns its intentional DTO and service identity',
    async (subject) => {
      const response = await authorizedRequest(subject.path)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(subject.body)
      expect(subject.service).toHaveBeenCalledWith(...subject.args)
      expectFinanceServicesCalledOnly(subject.service)
      expectPrivateNoStore(response)
    },
  )

  test('uses a null transaction continuation when fromId is omitted', async () => {
    mocks.getWalletTransactions.mockResolvedValueOnce({
      ...walletTransactions,
      fromId: null,
    })

    const response = await authorizedRequest(`/${characterId}/wallet/transactions`)

    expect(response.status).toBe(200)
    expect(mocks.getWalletTransactions).toHaveBeenCalledWith(characterId, null)
    await expect(response.json()).resolves.toMatchObject({ fromId: null, nextFromId: 501 })
  })

  test('serves every Finance family through the final application mount', async () => {
    const paths = successCases().map((subject) => `/api/me/characters${subject.path}`)

    for (const path of paths) {
      const response = await app.request(path, { headers: mountedHeaders })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('vary')).toBe('Cookie, Origin')
    }
  })
})

describe('Finance validation and middleware ordering', () => {
  test.each([
    ['missing journal page', `/${characterId}/wallet/journal`],
    ['zero journal page', `/${characterId}/wallet/journal?page=0`],
    ['leading-zero journal page', `/${characterId}/wallet/journal?page=01`],
    ['fractional journal page', `/${characterId}/wallet/journal?page=1.5`],
    ['unsafe journal page', `/${characterId}/wallet/journal?page=9007199254740992`],
    ['duplicate journal page', `/${characterId}/wallet/journal?page=1&page=2`],
    ['unknown journal query', `/${characterId}/wallet/journal?page=1&other=2`],
    ['zero transaction continuation', `/${characterId}/wallet/transactions?fromId=0`],
    ['signed transaction continuation', `/${characterId}/wallet/transactions?fromId=%2B1`],
    ['exponent transaction continuation', `/${characterId}/wallet/transactions?fromId=1e2`],
    ['unknown transaction query', `/${characterId}/wallet/transactions?other=2`],
    ['missing order-history page', `/${characterId}/market/orders/history`],
    ['negative order-history page', `/${characterId}/market/orders/history?page=-1`],
    ['missing contract page', `/${characterId}/contracts`],
    ['non-numeric contract page', `/${characterId}/contracts?page=page`],
    ['zero contract ID', `/${characterId}/contracts/0/items?contractPage=1`],
    ['leading-zero contract ID', `/${characterId}/contracts/01/items?contractPage=1`],
    ['fractional contract ID', `/${characterId}/contracts/1.5/bids?contractPage=1`],
    ['unsafe contract ID', `/${characterId}/contracts/9007199254740992/items?contractPage=1`],
    ['missing referenced contract page', `/${characterId}/contracts/${contractId}/items`],
    [
      'zero referenced contract page',
      `/${characterId}/contracts/${contractId}/bids?contractPage=0`,
    ],
    [
      'duplicate referenced contract page',
      `/${characterId}/contracts/${contractId}/items?contractPage=1&contractPage=2`,
    ],
    [
      'unknown contract-detail query',
      `/${characterId}/contracts/${contractId}/bids?contractPage=1&other=2`,
    ],
  ])('rejects %s before session, ownership, or Finance services', async (_name, path) => {
    const response = await authorizedRequest(path)

    expect(response.status).toBe(400)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expectFinanceServicesUntouched()
    expectPrivateNoStore(response)
  })

  test.each(financePaths())(
    'rejects anonymous $name before ownership or Finance work',
    async (subject) => {
      const response = await characterRoutes.request(subject.path)

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({
        code: 'AUTH_REQUIRED',
        message: 'Log in with EVE Online first.',
      })
      expect(mocks.findSession).not.toHaveBeenCalled()
      expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
      expectFinanceServicesUntouched()
      expectPrivateNoStore(response)
    },
  )

  test.each(financePaths())(
    'rejects a non-owned character before $name service work',
    async (subject) => {
      mocks.findOwnedCharacter.mockResolvedValueOnce(null)

      const response = await authorizedRequest(subject.path)

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        code: 'CHARACTER_NOT_FOUND',
        message: 'Character not found.',
      })
      expectFinanceServicesUntouched()
      expectPrivateNoStore(response)
    },
  )
})

describe('Finance authorization outcomes', () => {
  test.each(financeCases())(
    '$name returns its exact scope and Finance return target when the scope is absent',
    async (subject) => {
      subject.service.mockRejectedValueOnce(new ScopeRequiredError('deliberately-wrong-scope'))

      const response = await authorizedRequest(subject.path)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        code: 'EVE_SCOPE_REQUIRED',
        message: subject.scopeMessage,
        requiredScope: subject.scope,
        authorizeUrl: authorizeUrl(characterId),
      })
      expectPrivateNoStore(response)
    },
  )

  test.each(financeCases())(
    '$name returns its exact scope and Finance return target for rejected authorization',
    async (subject) => {
      for (const status of [401, 403]) {
        subject.service.mockRejectedValueOnce(Object.assign(new Error('Rejected'), { status }))

        const response = await authorizedRequest(subject.path)

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({
          code: 'EVE_REAUTH_REQUIRED',
          message: 'EVE authorization is no longer valid.',
          requiredScope: subject.scope,
          authorizeUrl: authorizeUrl(characterId),
        })
        expectPrivateNoStore(response)
      }
    },
  )
})

describe('Finance quota, not-found, and unavailable outcomes', () => {
  test.each([
    {
      name: 'wallet journal',
      service: mocks.getWalletJournal,
      path: `/${characterId}/wallet/journal?page=2`,
      error: new WalletQuotaError(11),
      message: 'ESI wallet quota is temporarily exhausted.',
    },
    {
      name: 'market orders',
      service: mocks.getCharacterMarketOrders,
      path: `/${characterId}/market/orders`,
      error: new MarketQuotaError(12),
      message: 'ESI market quota is temporarily exhausted.',
    },
    {
      name: 'contract items',
      service: mocks.getCharacterContractItems,
      path: `/${characterId}/contracts/${contractId}/items?contractPage=4`,
      error: new ContractQuotaError(13),
      message: 'ESI contract quota is temporarily exhausted.',
    },
  ])('$name exposes bounded retry timing', async (subject) => {
    subject.service.mockRejectedValueOnce(subject.error)

    const response = await authorizedRequest(subject.path)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe(String(subject.error.retryAfterSeconds))
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_QUOTA_EXHAUSTED',
      message: subject.message,
      retryAfterSeconds: subject.error.retryAfterSeconds,
    })
    expectPrivateNoStore(response)
  })

  test.each([
    [
      'items',
      mocks.getCharacterContractItems,
      `/${characterId}/contracts/${contractId}/items?contractPage=4`,
    ],
    [
      'bids',
      mocks.getCharacterContractBids,
      `/${characterId}/contracts/${contractId}/bids?contractPage=4`,
    ],
  ])('maps an ineligible parent page to the same contract %s 404', async (_name, service, path) => {
    service.mockRejectedValueOnce(new ContractNotFoundError())

    const response = await authorizedRequest(path)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      code: 'CONTRACT_NOT_FOUND',
      message: 'Contract not found in the referenced page.',
    })
    expect(service).toHaveBeenCalledWith(characterId, contractId, 4)
    expectPrivateNoStore(response)
  })

  test.each(financeCases())('$name sanitizes an independent service failure', async (subject) => {
    subject.service.mockRejectedValueOnce(new Error('private provider failure'))

    const response = await authorizedRequest(subject.path)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_UNAVAILABLE',
      message: subject.unavailableMessage,
    })
    expectFinanceServicesCalledOnly(subject.service)
    expectPrivateNoStore(response)
  })

  test.each(financeCases())(
    '$name preserves the token refresh unavailable outcome',
    async (subject) => {
      subject.service.mockRejectedValueOnce(new TokenRefreshUnavailableError())

      const response = await authorizedRequest(subject.path)

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({
        code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
        message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
      })
      expectFinanceServicesCalledOnly(subject.service)
      expectPrivateNoStore(response)
    },
  )
})

describe('Finance route exclusions', () => {
  test.each([
    '/api/corporations/98000001/wallet',
    '/api/corporations/98000001/market/orders',
    '/api/corporations/98000001/contracts',
    '/api/alliances/99000001/wallet',
    '/api/alliances/99000001/market/orders',
    '/api/alliances/99000001/contracts',
  ])('does not expose %s', async (path) => {
    const response = await app.request(path, { headers: mountedHeaders })

    expect(response.status).toBe(404)
    expectFinanceServicesUntouched()
  })
})

function successCases() {
  return [
    {
      name: 'wallet balance',
      path: `/${characterId}/wallet`,
      service: mocks.getWalletBalance,
      args: [characterId],
      body: { characterId, ...walletBalance },
    },
    {
      name: 'wallet journal page',
      path: `/${characterId}/wallet/journal?page=2`,
      service: mocks.getWalletJournal,
      args: [characterId, 2],
      body: { characterId, ...walletJournal },
    },
    {
      name: 'wallet transaction continuation',
      path: `/${characterId}/wallet/transactions?fromId=600`,
      service: mocks.getWalletTransactions,
      args: [characterId, 600],
      body: { characterId, ...walletTransactions },
    },
    {
      name: 'personal market orders',
      path: `/${characterId}/market/orders`,
      service: mocks.getCharacterMarketOrders,
      args: [characterId],
      body: { characterId, ...marketOrders },
    },
    {
      name: 'personal market order history page',
      path: `/${characterId}/market/orders/history?page=3`,
      service: mocks.getCharacterMarketOrderHistory,
      args: [characterId, 3],
      body: { characterId, ...marketOrderHistory },
    },
    {
      name: 'personal contract page',
      path: `/${characterId}/contracts?page=4`,
      service: mocks.getCharacterContracts,
      args: [characterId, 4],
      body: { characterId, ...contracts },
    },
    {
      name: 'contract items with parent-page authorization',
      path: `/${characterId}/contracts/${contractId}/items?contractPage=4`,
      service: mocks.getCharacterContractItems,
      args: [characterId, contractId, 4],
      body: { characterId, contractId, ...contractItems },
    },
    {
      name: 'contract bids with parent-page authorization',
      path: `/${characterId}/contracts/${contractId}/bids?contractPage=4`,
      service: mocks.getCharacterContractBids,
      args: [characterId, contractId, 4],
      body: { characterId, contractId, ...contractBids },
    },
  ]
}

function financePaths() {
  return successCases().map(({ name, path }) => ({ name, path }))
}

function financeCases() {
  return [
    {
      name: 'wallet balance',
      path: `/${characterId}/wallet`,
      service: mocks.getWalletBalance,
      scope: 'esi-wallet.read_character_wallet.v1',
      scopeMessage: 'Authorize wallet access for this character.',
      unavailableMessage: 'Unable to retrieve the EVE wallet balance.',
    },
    {
      name: 'wallet journal',
      path: `/${characterId}/wallet/journal?page=2`,
      service: mocks.getWalletJournal,
      scope: 'esi-wallet.read_character_wallet.v1',
      scopeMessage: 'Authorize wallet access for this character.',
      unavailableMessage: 'Unable to retrieve the wallet journal.',
    },
    {
      name: 'wallet transactions',
      path: `/${characterId}/wallet/transactions?fromId=600`,
      service: mocks.getWalletTransactions,
      scope: 'esi-wallet.read_character_wallet.v1',
      scopeMessage: 'Authorize wallet access for this character.',
      unavailableMessage: 'Unable to retrieve wallet transactions.',
    },
    {
      name: 'market orders',
      path: `/${characterId}/market/orders`,
      service: mocks.getCharacterMarketOrders,
      scope: 'esi-markets.read_character_orders.v1',
      scopeMessage: 'Authorize market order access for this character.',
      unavailableMessage: 'Unable to retrieve character market orders.',
    },
    {
      name: 'market order history',
      path: `/${characterId}/market/orders/history?page=3`,
      service: mocks.getCharacterMarketOrderHistory,
      scope: 'esi-markets.read_character_orders.v1',
      scopeMessage: 'Authorize market order access for this character.',
      unavailableMessage: 'Unable to retrieve character market order history.',
    },
    {
      name: 'contracts',
      path: `/${characterId}/contracts?page=4`,
      service: mocks.getCharacterContracts,
      scope: 'esi-contracts.read_character_contracts.v1',
      scopeMessage: 'Authorize contract access for this character.',
      unavailableMessage: 'Unable to retrieve character contracts.',
    },
    {
      name: 'contract items',
      path: `/${characterId}/contracts/${contractId}/items?contractPage=4`,
      service: mocks.getCharacterContractItems,
      scope: 'esi-contracts.read_character_contracts.v1',
      scopeMessage: 'Authorize contract access for this character.',
      unavailableMessage: 'Unable to retrieve character contract items.',
    },
    {
      name: 'contract bids',
      path: `/${characterId}/contracts/${contractId}/bids?contractPage=4`,
      service: mocks.getCharacterContractBids,
      scope: 'esi-contracts.read_character_contracts.v1',
      scopeMessage: 'Authorize contract access for this character.',
      unavailableMessage: 'Unable to retrieve character contract bids.',
    },
  ]
}

function authorizedRequest(path: string) {
  return characterRoutes.request(path, { headers: sessionHeaders })
}

function financeServices() {
  return [
    mocks.getWalletBalance,
    mocks.getWalletJournal,
    mocks.getWalletTransactions,
    mocks.getCharacterMarketOrders,
    mocks.getCharacterMarketOrderHistory,
    mocks.getCharacterContracts,
    mocks.getCharacterContractItems,
    mocks.getCharacterContractBids,
  ]
}

function expectFinanceServicesUntouched() {
  for (const service of financeServices()) expect(service).not.toHaveBeenCalled()
}

function expectFinanceServicesCalledOnly(expected: ReturnType<typeof vi.fn>) {
  const services = financeServices()
  expect(services.map((service) => service.mock.calls.length)).toEqual(
    services.map((service) => (service === expected ? 1 : 0)),
  )
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}

function authorizeUrl(selectedCharacterId: number) {
  return `http://localhost:8788/auth/eve/reauthorize/${selectedCharacterId}?returnTo=%2Fcharacters%2F${selectedCharacterId}%2Ffinance`
}
