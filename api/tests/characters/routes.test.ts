import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteCharacter: vi.fn(),
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  getCharacterEmploymentHistory: vi.fn(),
  getCharacterContractBids: vi.fn(),
  getCharacterContractItems: vi.fn(),
  getCharacterContracts: vi.fn(),
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
}))

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
  ScopeRequiredError: class ScopeRequiredError extends Error {
    constructor(readonly scope: string) {
      super(`Missing ${scope}`)
    }
  },
  TokenRefreshUnavailableError: class TokenRefreshUnavailableError extends Error {},
}))

vi.mock('../../src/characters/profile.js', () => ({
  getCharacterProfile: mocks.getCharacterProfile,
}))

vi.mock('../../src/characters/history.js', () => ({
  getCharacterEmploymentHistory: mocks.getCharacterEmploymentHistory,
}))

vi.mock('../../src/characters/overview.js', () => ({
  getCharacterLocation: mocks.getCharacterLocation,
  getCharacterShip: mocks.getCharacterShip,
  getCharacterSkillsSummary: mocks.getCharacterSkillsSummary,
  locationScope: 'esi-location.read_location.v1',
  shipScope: 'esi-location.read_ship_type.v1',
  skillsScope: 'esi-skills.read_skills.v1',
}))

vi.mock('../../src/characters/wallet.js', () => ({
  getWalletBalance: mocks.getWalletBalance,
  getWalletJournal: mocks.getWalletJournal,
  getWalletTransactions: mocks.getWalletTransactions,
  walletScope: 'esi-wallet.read_character_wallet.v1',
  WalletQuotaError: class WalletQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('Quota exhausted')
    }
  },
}))

vi.mock('../../src/characters/market.js', () => ({
  getCharacterMarketOrderHistory: mocks.getCharacterMarketOrderHistory,
  getCharacterMarketOrders: mocks.getCharacterMarketOrders,
  marketOrdersScope: 'esi-markets.read_character_orders.v1',
  MarketQuotaError: class MarketQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('Quota exhausted')
    }
  },
}))

vi.mock('../../src/characters/contracts.js', () => ({
  characterContractsScope: 'esi-contracts.read_character_contracts.v1',
  ContractNotFoundError: class ContractNotFoundError extends Error {},
  ContractQuotaError: class ContractQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('Quota exhausted')
    }
  },
  getCharacterContractBids: mocks.getCharacterContractBids,
  getCharacterContractItems: mocks.getCharacterContractItems,
  getCharacterContracts: mocks.getCharacterContracts,
}))

vi.mock('../../src/characters/skills.js', () => ({
  characterSkillsScope: 'esi-skills.read_skills.v1',
  getCharacterSkills: mocks.getCharacterSkills,
}))

import { characterRoutes } from '../../src/characters/routes.js'
import { EsiQuotaError } from '../../src/esi-resilience/cooldowns.js'
import { app } from '../../src/index.js'
import { ScopeRequiredError } from '../../src/auth/tokens.js'
import { WalletQuotaError } from '../../src/characters/wallet.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const mainCharacter = {
  characterId: 1404328063,
  name: 'Bandera Primary',
  corporationId: 1000166,
  allianceId: null,
  isMain: true,
}
const altCharacter = {
  characterId: 2112625428,
  name: 'Bandera Alt',
  corporationId: 1000166,
  allianceId: 99000001,
  isMain: false,
}
const altSubjectLifecycleId = 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011'
const ownedAltCharacter = { ...altCharacter, subjectLifecycleId: altSubjectLifecycleId }
const session = { userId, mainCharacter }
const freshness = {
  cachedUntil: '2026-09-01T11:01:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  stale: false,
}
const profile = {
  id: altCharacter.characterId,
  name: altCharacter.name,
  birthday: '2020-01-01T00:00:00Z',
  gender: 'male',
  race: 'Caldari',
  bloodline: 'Deteis',
  securityStatus: 1.2,
  raceFactionId: 500001,
  achievementScore: 10,
  corporation: { id: 1000166, name: 'Test Corp', ticker: 'TEST', memberCount: 5 },
  alliance: { id: 99000001, name: 'Test Alliance', ticker: 'ALLY' },
  ...freshness,
}
const location = { solarSystemId: 30000142, solarSystemName: 'Jita', ...freshness }
const ship = { typeId: 670, typeName: 'Capsule', name: 'My Pod', ...freshness }

beforeEach(() => {
  mocks.deleteCharacter.mockResolvedValue('deleted')
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(ownedAltCharacter)
  mocks.listUserCharacters.mockResolvedValue([mainCharacter, altCharacter])
  mocks.setMainCharacter.mockResolvedValue({ ...altCharacter, isMain: true })
  mocks.getCharacterProfile.mockResolvedValue(profile)
  mocks.getCharacterEmploymentHistory.mockResolvedValue([
    {
      recordId: 1,
      startDate: '2020-01-01T00:00:00Z',
      isDeleted: false,
      corporation: { id: 1000166, name: 'Test Corp' },
    },
  ])
  mocks.getCharacterLocation.mockResolvedValue(location)
  mocks.getCharacterShip.mockResolvedValue(ship)
  mocks.getCharacterSkillsSummary.mockResolvedValue({
    totalSp: 5_000_000,
    unallocatedSp: 0,
    ...freshness,
  })
  mocks.getWalletBalance.mockResolvedValue({
    balance: 1_234_567.89,
    cachedUntil: new Date().toISOString(),
    validatedAt: new Date().toISOString(),
    stale: false,
  })
  mocks.getWalletTransactions.mockResolvedValue({
    transactions: [
      {
        transactionId: 1,
        journalRefId: 2,
        date: '2026-08-20T12:00:00.000Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 5,
        unitPrice: 10,
        totalPrice: 50,
        isBuy: true,
        locationId: 60_000_001,
      },
    ],
    fromId: null,
    nextFromId: 1,
    cachedUntil: new Date().toISOString(),
    validatedAt: new Date().toISOString(),
    stale: false,
  })
})

describe('character roster', () => {
  test('rejects an unauthenticated roster without querying account data', async () => {
    const response = await characterRoutes.request('/')

    expect(response.status).toBe(401)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.listUserCharacters).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('returns only the store-isolated roster summaries with stable main-first order', async () => {
    const response = await authorizedRequest('/')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      characters: [
        {
          ...mainCharacter,
          birthday: profile.birthday,
          securityStatus: profile.securityStatus,
          raceFactionId: profile.raceFactionId,
          location,
          ship,
          walletBalance: 1_234_567.89,
          totalSp: 5_000_000,
          corporation: { id: mainCharacter.corporationId, name: 'Test Corp' },
          alliance: null,
        },
        {
          ...altCharacter,
          birthday: profile.birthday,
          securityStatus: profile.securityStatus,
          raceFactionId: profile.raceFactionId,
          location,
          ship,
          walletBalance: 1_234_567.89,
          totalSp: 5_000_000,
          corporation: { id: altCharacter.corporationId, name: 'Test Corp' },
          alliance: { id: altCharacter.allianceId, name: 'Test Alliance' },
        },
      ],
    })
    expect(mocks.listUserCharacters).toHaveBeenCalledWith(userId)
    expect(mocks.getCharacterProfile).toHaveBeenCalledWith(mainCharacter.characterId)
    expect(mocks.getCharacterProfile).toHaveBeenCalledWith(altCharacter.characterId)
    expect(mocks.getCharacterLocation).toHaveBeenCalledWith(mainCharacter.characterId)
    expect(mocks.getCharacterLocation).toHaveBeenCalledWith(altCharacter.characterId)
    expect(mocks.getCharacterShip).toHaveBeenCalledWith(mainCharacter.characterId)
    expect(mocks.getCharacterShip).toHaveBeenCalledWith(altCharacter.characterId)
    expect(JSON.stringify(body)).not.toMatch(/token|refresh|encrypted/i)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('retains the roster with deterministic labels when affiliation enrichment is unavailable', async () => {
    mocks.getCharacterProfile.mockRejectedValue(new Error('ESI unavailable'))

    const response = await authorizedRequest('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      characters: [
        {
          ...mainCharacter,
          birthday: null,
          securityStatus: null,
          raceFactionId: null,
          location,
          ship,
          walletBalance: 1_234_567.89,
          totalSp: 5_000_000,
          corporation: { id: mainCharacter.corporationId, name: 'Unknown corporation' },
          alliance: null,
        },
        {
          ...altCharacter,
          birthday: null,
          securityStatus: null,
          raceFactionId: null,
          location,
          ship,
          walletBalance: 1_234_567.89,
          totalSp: 5_000_000,
          corporation: { id: altCharacter.corporationId, name: 'Unknown corporation' },
          alliance: { id: altCharacter.allianceId, name: 'Unknown alliance' },
        },
      ],
    })
  })

  test('retains roster entries when location or ship data is unavailable', async () => {
    mocks.getCharacterLocation.mockRejectedValue(new Error('ESI unavailable'))
    mocks.getCharacterShip.mockRejectedValue(
      new ScopeRequiredError('esi-location.read_ship_type.v1'),
    )

    const response = await authorizedRequest('/')
    const body = (await response.json()) as {
      characters: Array<{ location: unknown; ship: unknown }>
    }

    expect(response.status).toBe(200)
    expect(body.characters).toHaveLength(2)
    expect(body.characters.every((character) => character.location === null)).toBe(true)
    expect(body.characters.every((character) => character.ship === null)).toBe(true)
  })
})

describe('owned character overview', () => {
  test('validates character IDs before loading a session or ownership', async () => {
    const response = await app.request('/api/me/characters/not-a-number', {
      headers: { Cookie: 'eve_space_session=active-session' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Character ID must be a positive integer.' })
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
  })

  test('returns an indistinguishable 404 before any character service for non-owned IDs', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      code: 'CHARACTER_NOT_FOUND',
      message: 'Character not found.',
    })
    expect(mocks.findOwnedCharacter).toHaveBeenCalledWith(userId, 90000001)
    expect(mocks.getCharacterProfile).not.toHaveBeenCalled()
    expect(mocks.getCharacterLocation).not.toHaveBeenCalled()
    expect(mocks.getCharacterSkillsSummary).not.toHaveBeenCalled()
  })

  test('composes overview data using the owned route character rather than the main', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      profile,
      location: { status: 'ok', data: location },
      ship: { status: 'ok', data: ship },
      skills: {
        status: 'ok',
        data: { totalSp: 5_000_000, unallocatedSp: 0, ...freshness },
      },
      ...freshness,
    })
    expect(mocks.getCharacterProfile).toHaveBeenCalledWith(altCharacter.characterId)
    expect(mocks.getCharacterLocation).toHaveBeenCalledWith(altCharacter.characterId)
    expect(mocks.getCharacterShip).toHaveBeenCalledWith(altCharacter.characterId)
    expect(mocks.getCharacterSkillsSummary).toHaveBeenCalledWith(altCharacter.characterId)
  })

  test('reports stale location and ship metadata at the overview root', async () => {
    mocks.getCharacterShip.mockResolvedValue({
      ...ship,
      cachedUntil: '2026-09-01T10:59:00.000Z',
      validatedAt: '2026-09-01T10:58:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })

    const response = await authorizedRequest(`/${altCharacter.characterId}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cachedUntil: '2026-09-01T10:59:00.000Z',
      validatedAt: '2026-09-01T10:58:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
  })

  test('returns character-bound reauthorization links for scope failures', async () => {
    mocks.getCharacterLocation.mockRejectedValue(
      new ScopeRequiredError('esi-location.read_location.v1'),
    )

    const response = await authorizedRequest(`/${altCharacter.characterId}`)
    const body = (await response.json()) as {
      location: { status: string; requiredScope: string; authorizeUrl: string }
    }

    expect(body.location).toEqual({
      status: 'scope-required',
      message: 'Authorize this scope to view this data: esi-location.read_location.v1',
      requiredScope: 'esi-location.read_location.v1',
      authorizeUrl: `http://localhost:8788/auth/eve/reauthorize/${altCharacter.characterId}`,
    })
  })

  test('maps rejected authorization and unavailable sections without failing the overview', async () => {
    mocks.getCharacterShip.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    mocks.getCharacterSkillsSummary.mockRejectedValue(new Error('ESI unavailable'))

    const response = await authorizedRequest(`/${altCharacter.characterId}`)
    const body = (await response.json()) as { ship: { status: string }; skills: { status: string } }

    expect(response.status).toBe(200)
    expect(body.ship.status).toBe('scope-required')
    expect(body.skills.status).toBe('unavailable')
  })

  test('returns an explicit safe 502 when the public profile is unavailable', async () => {
    mocks.getCharacterProfile.mockRejectedValue(new Error('ESI unavailable'))

    const response = await authorizedRequest(`/${altCharacter.characterId}`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      message: 'EVE Online ESI is temporarily unavailable. Try again shortly.',
    })
  })
})

describe('owned character wallet', () => {
  test('loads the wallet for the owned path character rather than the main', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}/wallet`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      characterId: altCharacter.characterId,
      balance: 1_234_567.89,
    })
    expect(mocks.getWalletBalance).toHaveBeenCalledWith(altCharacter.characterId)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('does not load a wallet for a non-owned character', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001/wallet')

    expect(response.status).toBe(404)
    expect(mocks.getWalletBalance).not.toHaveBeenCalled()
  })

  test('returns character-bound wallet authorization details', async () => {
    mocks.getWalletBalance.mockRejectedValue(
      new ScopeRequiredError('esi-wallet.read_character_wallet.v1'),
    )

    const response = await authorizedRequest(`/${altCharacter.characterId}/wallet`)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Authorize wallet access for this character.',
      requiredScope: 'esi-wallet.read_character_wallet.v1',
      authorizeUrl: financeAuthorizeUrl(altCharacter.characterId),
    })
  })

  test('maps wallet quota, rejected tokens, and unavailable ESI responses', async () => {
    mocks.getWalletBalance.mockRejectedValueOnce(new WalletQuotaError(30))
    const quota = await authorizedRequest(`/${altCharacter.characterId}/wallet`)
    expect(quota.status).toBe(429)
    expect(quota.headers.get('retry-after')).toBe('30')

    mocks.getWalletBalance.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    )
    const rejected = await authorizedRequest(`/${altCharacter.characterId}/wallet`)
    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({
      code: 'EVE_REAUTH_REQUIRED',
      authorizeUrl: financeAuthorizeUrl(altCharacter.characterId),
    })

    mocks.getWalletBalance.mockRejectedValueOnce(new Error('ESI unavailable'))
    const unavailable = await authorizedRequest(`/${altCharacter.characterId}/wallet`)
    expect(unavailable.status).toBe(502)
  })

  test('loads transactions for the owned path character', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}/wallet/transactions`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      characterId: altCharacter.characterId,
      transactions: [{ transactionId: 1, typeName: 'Tritanium' }],
    })
    expect(mocks.getWalletTransactions).toHaveBeenCalledWith(altCharacter.characterId, null)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('does not load transactions for a non-owned character', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001/wallet/transactions')

    expect(response.status).toBe(404)
    expect(mocks.getWalletTransactions).not.toHaveBeenCalled()
  })

  test('maps transaction authorization, quota, and ESI failures', async () => {
    mocks.getWalletTransactions.mockRejectedValueOnce(
      new ScopeRequiredError('esi-wallet.read_character_wallet.v1'),
    )
    const scope = await authorizedRequest(`/${altCharacter.characterId}/wallet/transactions`)
    expect(scope.status).toBe(403)
    expect(await scope.json()).toMatchObject({
      code: 'EVE_SCOPE_REQUIRED',
      authorizeUrl: financeAuthorizeUrl(altCharacter.characterId),
    })

    mocks.getWalletTransactions.mockRejectedValueOnce(new WalletQuotaError(45))
    const quota = await authorizedRequest(`/${altCharacter.characterId}/wallet/transactions`)
    expect(quota.status).toBe(429)
    expect(quota.headers.get('retry-after')).toBe('45')

    mocks.getWalletTransactions.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    )
    const rejected = await authorizedRequest(`/${altCharacter.characterId}/wallet/transactions`)
    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({ code: 'EVE_REAUTH_REQUIRED' })

    mocks.getWalletTransactions.mockRejectedValueOnce(new Error('ESI unavailable'))
    const unavailable = await authorizedRequest(`/${altCharacter.characterId}/wallet/transactions`)
    expect(unavailable.status).toBe(502)
  })
})

describe('owned character employment history', () => {
  test('returns mapped history for the owned path character', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}/history`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      characterId: altCharacter.characterId,
      history: [{ corporation: { name: 'Test Corp' } }],
    })
    expect(mocks.getCharacterEmploymentHistory).toHaveBeenCalledWith(altCharacter.characterId)
  })

  test('does not load history for a non-owned character', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001/history')

    expect(response.status).toBe(404)
    expect(mocks.getCharacterEmploymentHistory).not.toHaveBeenCalled()
  })

  test('returns a safe error when employment history is unavailable', async () => {
    mocks.getCharacterEmploymentHistory.mockRejectedValue(new Error('ESI unavailable'))

    const response = await authorizedRequest(`/${altCharacter.characterId}/history`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      code: 'ESI_UNAVAILABLE',
      message: 'Employment history is temporarily unavailable.',
    })
  })

  test('maps employment history cooldowns to a retryable response', async () => {
    mocks.getCharacterEmploymentHistory.mockRejectedValue(new EsiQuotaError(12))

    const response = await authorizedRequest(`/${altCharacter.characterId}/history`)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('12')
    expect(await response.json()).toEqual({
      code: 'ESI_COOLDOWN',
      message: 'EVE Online ESI is temporarily rate limited.',
      retryAfterSeconds: 12,
    })
  })
})

describe('main character selection', () => {
  test('passes the owned target to the serialized main-selection store operation', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}/main`, 'PATCH')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mainCharacter: { ...altCharacter, isMain: true } })
    expect(mocks.setMainCharacter).toHaveBeenCalledWith(userId, altCharacter.characterId)
  })

  test('returns the same 404 and never changes main for a non-owned target', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001/main', 'PATCH')

    expect(response.status).toBe(404)
    expect(mocks.setMainCharacter).not.toHaveBeenCalled()
  })

  test('returns a 404 if the target disappears during the transaction', async () => {
    mocks.setMainCharacter.mockResolvedValue(null)

    const response = await authorizedRequest(`/${altCharacter.characterId}/main`, 'PATCH')

    expect(response.status).toBe(404)
  })
})

describe('character deletion', () => {
  test('deletes an owned non-main character', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}`, 'DELETE')

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.deleteCharacter).toHaveBeenCalledWith(
      userId,
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
  })

  test('rejects deletion of the current main character', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(mainCharacter)
    mocks.deleteCharacter.mockResolvedValue('main-character')

    const response = await authorizedRequest(`/${mainCharacter.characterId}`, 'DELETE')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'MAIN_CHARACTER_DELETE_FORBIDDEN',
      message: 'Choose another main character before deleting this one.',
    })
  })

  test('returns the same 404 and never deletes a non-owned target', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001', 'DELETE')

    expect(response.status).toBe(404)
    expect(mocks.deleteCharacter).not.toHaveBeenCalled()
  })

  test('returns a 404 if the character disappears during deletion', async () => {
    mocks.deleteCharacter.mockResolvedValue('not-found')

    const response = await authorizedRequest(`/${altCharacter.characterId}`, 'DELETE')

    expect(response.status).toBe(404)
  })
})

function authorizedRequest(path: string, method = 'GET') {
  return characterRoutes.request(path, {
    method,
    headers: { Cookie: 'eve_space_session=active-session' },
  })
}

function financeAuthorizeUrl(characterId: number) {
  return `http://localhost:8788/auth/eve/reauthorize/${characterId}?returnTo=%2Fcharacters%2F${characterId}%2Ffinance`
}
