import { hc, type InferRequestType } from 'hono/client'
import { beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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
}))

vi.mock('../../src/auth/character-lifecycle.js', () => ({
  deleteCharacter: mocks.deleteCharacter,
  findOwnedCharacter: mocks.findOwnedCharacter,
  listUserCharacters: mocks.listUserCharacters,
  setMainCharacter: mocks.setMainCharacter,
}))

vi.mock('../../src/auth/session-store.js', () => ({ findSession: mocks.findSession }))

vi.mock('../../src/env.js', () => ({
  env: {
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  },
}))

vi.mock('../../src/auth/token-errors.js', () => ({
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
  getCharacterEmploymentHistoryResult: mocks.getCharacterEmploymentHistory,
}))

vi.mock('../../src/characters/overview.js', () => ({
  getCharacterLocation: mocks.getCharacterLocation,
  getCharacterShip: mocks.getCharacterShip,
  locationScope: 'esi-location.read_location.v1',
  shipScope: 'esi-location.read_ship_type.v1',
}))

vi.mock('../../src/characters/wallet.js', () => ({
  getWalletBalance: mocks.getWalletBalance,
  getWalletJournal: mocks.getWalletJournal,
  getWalletTransactions: mocks.getWalletTransactions,
  walletScope: 'esi-wallet.read_character_wallet.v1',
}))

vi.mock('../../src/characters/market.js', () => ({
  getCharacterMarketOrderHistory: mocks.getCharacterMarketOrderHistory,
  getCharacterMarketOrders: mocks.getCharacterMarketOrders,
  marketOrdersScope: 'esi-markets.read_character_orders.v1',
}))

vi.mock('../../src/characters/contracts.js', () => ({
  ContractNotFoundError: class ContractNotFoundError extends Error {},
  characterContractsScope: 'esi-contracts.read_character_contracts.v1',
  getCharacterContractBids: mocks.getCharacterContractBids,
  getCharacterContractItems: mocks.getCharacterContractItems,
  getCharacterContracts: mocks.getCharacterContracts,
}))

vi.mock('../../src/characters/skills.js', () => ({
  characterSkillsScope: 'esi-skills.read_skills.v1',
  getCharacterSkills: mocks.getCharacterSkills,
  getCharacterSkillsSummary: mocks.getCharacterSkillsSummary,
}))

import { characterRoutes } from '../../src/characters/routes.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../../src/auth/token-errors.js'
import { app, type AppType } from '../../src/index.js'

const mountedClient = hc<AppType>('http://localhost:8788')
const mountedCharacter = mountedClient.api.me.characters[':characterId']

type DeleteCharacterRequest = InferRequestType<(typeof mountedCharacter)['$delete']>

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const mainCharacter = {
  allianceId: null,
  characterId: 1_404_328_063,
  corporationId: 1_000_166,
  isMain: true,
  name: 'Bandera Primary',
}
const altCharacter = {
  allianceId: 99_000_001,
  characterId: 2_112_625_428,
  corporationId: 1_000_166,
  isMain: false,
  name: 'Bandera Alt',
}
const altSubjectLifecycleId = 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011'
const mainSubjectLifecycleId = '614247fe-7206-4a65-8783-30670002d833'
const ownedAltCharacter = { ...altCharacter, subjectLifecycleId: altSubjectLifecycleId }
const session = { mainCharacter, userId }
const freshness = {
  cachedUntil: '2026-09-01T11:01:00.000Z',
  stale: false,
  validatedAt: '2026-09-01T11:00:00.000Z',
}
const profile = {
  achievementScore: 10,
  alliance: { id: 99_000_001, name: 'Test Alliance', ticker: 'ALLY' },
  birthday: '2020-01-01T00:00:00Z',
  bloodline: 'Deteis',
  corporation: { id: 1_000_166, memberCount: 5, name: 'Test Corp', ticker: 'TEST' },
  gender: 'male',
  id: altCharacter.characterId,
  name: altCharacter.name,
  race: 'Caldari',
  raceFactionId: 500_001,
  securityStatus: 1.2,
  ...freshness,
}
const location = {
  locationType: 'space' as const,
  solarSystemId: 30_000_142,
  solarSystemName: 'Jita',
  solarSystemSecurityStatus: 0.945,
  ...freshness,
}
const ship = { groupId: 29, name: 'My Pod', typeId: 670, typeName: 'Capsule', ...freshness }

beforeEach(() => {
  mocks.deleteCharacter.mockResolvedValue('deleted')
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(ownedAltCharacter)
  mocks.listUserCharacters.mockResolvedValue([
    { ...mainCharacter, subjectLifecycleId: mainSubjectLifecycleId },
    { ...altCharacter, subjectLifecycleId: altSubjectLifecycleId },
  ])
  mocks.setMainCharacter.mockResolvedValue({ ...altCharacter, isMain: true })
  mocks.getCharacterProfile.mockResolvedValue(profile)
  mocks.getCharacterEmploymentHistory.mockResolvedValue({
    data: [
      {
        recordId: 1,
        startDate: '2020-01-01T00:00:00Z',
        isDeleted: false,
        corporation: { id: 1_000_166, name: 'Test Corp' },
      },
    ],
    quota: {},
    source: 'cache',
    ...freshness,
  })
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
    stale: false,
    validatedAt: new Date().toISOString(),
  })
  mocks.getWalletTransactions.mockResolvedValue({
    cachedUntil: new Date().toISOString(),
    fromId: null,
    nextFromId: 1,
    stale: false,
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
    validatedAt: new Date().toISOString(),
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
    expect(body).toStrictEqual({
      characters: [
        {
          ...mainCharacter,
          alliance: null,
          birthday: profile.birthday,
          corporation: { id: mainCharacter.corporationId, name: 'Test Corp' },
          location,
          raceFactionId: profile.raceFactionId,
          securityStatus: profile.securityStatus,
          ship,
          totalSp: 5_000_000,
          walletBalance: 1_234_567.89,
        },
        {
          ...altCharacter,
          alliance: { id: altCharacter.allianceId, name: 'Test Alliance' },
          birthday: profile.birthday,
          corporation: { id: altCharacter.corporationId, name: 'Test Corp' },
          location,
          raceFactionId: profile.raceFactionId,
          securityStatus: profile.securityStatus,
          ship,
          totalSp: 5_000_000,
          walletBalance: 1_234_567.89,
        },
      ],
    })
    expect(mocks.listUserCharacters).toHaveBeenCalledWith(userId)
    expect(mocks.getCharacterProfile).toHaveBeenCalledWith(mainCharacter.characterId)
    expect(mocks.getCharacterProfile).toHaveBeenCalledWith(altCharacter.characterId)
    expect(mocks.getCharacterLocation).toHaveBeenCalledWith(
      mainCharacter.characterId,
      mainSubjectLifecycleId,
    )
    expect(mocks.getCharacterLocation).toHaveBeenCalledWith(
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
    expect(mocks.getCharacterShip).toHaveBeenCalledWith(
      mainCharacter.characterId,
      mainSubjectLifecycleId,
    )
    expect(mocks.getCharacterShip).toHaveBeenCalledWith(
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
    expect(JSON.stringify(body)).not.toMatch(/token|refresh|encrypted/i)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('retains the roster with deterministic labels when affiliation enrichment is unavailable', async () => {
    mocks.getCharacterProfile.mockRejectedValue(new Error('ESI unavailable'))

    const response = await authorizedRequest('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual({
      characters: [
        {
          ...mainCharacter,
          alliance: null,
          birthday: null,
          corporation: { id: mainCharacter.corporationId, name: 'Unknown corporation' },
          location,
          raceFactionId: null,
          securityStatus: null,
          ship,
          totalSp: 5_000_000,
          walletBalance: 1_234_567.89,
        },
        {
          ...altCharacter,
          alliance: { id: altCharacter.allianceId, name: 'Unknown alliance' },
          birthday: null,
          corporation: { id: altCharacter.corporationId, name: 'Unknown corporation' },
          location,
          raceFactionId: null,
          securityStatus: null,
          ship,
          totalSp: 5_000_000,
          walletBalance: 1_234_567.89,
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

  test('returns the local roster when ESI enrichment stalls', async () => {
    vi.useFakeTimers()
    mocks.getCharacterProfile.mockImplementation(stalled)
    mocks.getCharacterLocation.mockImplementation(stalled)
    mocks.getCharacterShip.mockImplementation(stalled)
    mocks.getWalletBalance.mockImplementation(stalled)
    mocks.getCharacterSkillsSummary.mockImplementation(stalled)

    try {
      const responsePending = authorizedRequest('/')
      await vi.advanceTimersByTimeAsync(2000)
      const response = await responsePending
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.characters).toStrictEqual([
        expect.objectContaining({
          characterId: mainCharacter.characterId,
          location: null,
          name: mainCharacter.name,
          ship: null,
          totalSp: null,
          walletBalance: null,
        }),
        expect.objectContaining({
          characterId: altCharacter.characterId,
          location: null,
          name: altCharacter.name,
          ship: null,
          totalSp: null,
          walletBalance: null,
        }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('owned character overview', () => {
  test('validates character IDs before loading a session or ownership', async () => {
    const response = await app.request('/api/me/characters/not-a-number', {
      headers: { Cookie: 'eve_space_session=active-session' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toStrictEqual({
      message: 'Character ID must be a positive integer.',
    })
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
  })

  test('returns an indistinguishable 404 before any character service for non-owned IDs', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001')

    expect(response.status).toBe(404)
    expect(await response.json()).toStrictEqual({
      code: 'CHARACTER_NOT_FOUND',
      message: 'Character not found.',
    })
    expect(mocks.findOwnedCharacter).toHaveBeenCalledWith(userId, 90_000_001)
    expect(mocks.getCharacterProfile).not.toHaveBeenCalled()
    expect(mocks.getCharacterLocation).not.toHaveBeenCalled()
    expect(mocks.getCharacterSkillsSummary).not.toHaveBeenCalled()
  })

  test('composes overview data using the owned route character rather than the main', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual({
      location: { data: location, status: 'ok' },
      profile,
      ship: { data: ship, status: 'ok' },
      skills: {
        data: { totalSp: 5_000_000, unallocatedSp: 0, ...freshness },
        status: 'ok',
      },
      ...freshness,
    })
    expect(mocks.getCharacterProfile).toHaveBeenCalledWith(altCharacter.characterId)
    expect(mocks.getCharacterLocation).toHaveBeenCalledWith(
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
    expect(mocks.getCharacterShip).toHaveBeenCalledWith(
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
    expect(mocks.getCharacterSkillsSummary).toHaveBeenCalledWith(
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
  })

  test('retains the profile and exposes its aggregate stale metadata at the overview root', async () => {
    mocks.getCharacterProfile.mockResolvedValue({
      ...profile,
      cachedUntil: '2026-09-01T10:59:00.000Z',
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:07:00.000Z',
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
    })

    const response = await authorizedRequest(`/${altCharacter.characterId}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cachedUntil: '2026-09-01T10:59:00.000Z',
      profile: {
        id: altCharacter.characterId,
        stale: true,
        validatedAt: '2026-09-01T10:58:00.000Z',
      },
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:07:00.000Z',
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
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

    expect(body.location).toStrictEqual({
      authorizeUrl: `http://localhost:8788/auth/eve/reauthorize/${altCharacter.characterId}`,
      message: 'Authorize this scope to view this data: esi-location.read_location.v1',
      requiredScope: 'esi-location.read_location.v1',
      status: 'scope-required',
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

  test('maps token-refresh and cooldown failures to their existing unavailable sections', async () => {
    mocks.getCharacterLocation.mockRejectedValue(new TokenRefreshUnavailableError())
    mocks.getCharacterShip.mockRejectedValue(new EsiQuotaError(19))

    const response = await authorizedRequest(`/${altCharacter.characterId}`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      location: {
        message: 'EVE token refresh is temporarily unavailable.',
        status: 'unavailable',
      },
      ship: {
        message: 'EVE Online ESI is temporarily unavailable.',
        status: 'unavailable',
      },
    })
  })

  test('returns an explicit safe 502 when the public profile is unavailable', async () => {
    mocks.getCharacterProfile.mockRejectedValue(new Error('ESI unavailable'))

    const response = await authorizedRequest(`/${altCharacter.characterId}`)

    expect(response.status).toBe(502)
    expect(await response.json()).toStrictEqual({
      message: 'EVE Online ESI is temporarily unavailable. Try again shortly.',
    })
  })
})

describe('owned character wallet', () => {
  test('loads the wallet for the owned path character rather than the main', async () => {
    const response = await authorizedRequest(`/${altCharacter.characterId}/wallet`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      balance: 1_234_567.89,
      characterId: altCharacter.characterId,
    })
    expect(mocks.getWalletBalance).toHaveBeenCalledWith(
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
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
    expect(await response.json()).toStrictEqual({
      authorizeUrl: financeAuthorizeUrl(altCharacter.characterId),
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Authorize wallet access for this character.',
      requiredScope: 'esi-wallet.read_character_wallet.v1',
    })
  })

  test('maps wallet quota, rejected tokens, and unavailable ESI responses', async () => {
    mocks.getWalletBalance.mockRejectedValueOnce(new EsiQuotaError(30))
    const quota = await authorizedRequest(`/${altCharacter.characterId}/wallet`)
    expect(quota.status).toBe(429)
    expect(quota.headers.get('retry-after')).toBe('30')

    mocks.getWalletBalance.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    )
    const rejected = await authorizedRequest(`/${altCharacter.characterId}/wallet`)
    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({
      authorizeUrl: financeAuthorizeUrl(altCharacter.characterId),
      code: 'EVE_REAUTH_REQUIRED',
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
    expect(mocks.getWalletTransactions).toHaveBeenCalledWith(
      altCharacter.characterId,
      null,
      altSubjectLifecycleId,
    )
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
      authorizeUrl: financeAuthorizeUrl(altCharacter.characterId),
      code: 'EVE_SCOPE_REQUIRED',
    })

    mocks.getWalletTransactions.mockRejectedValueOnce(new EsiQuotaError(45))
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
      stale: false,
      validatedAt: freshness.validatedAt,
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
    expect(await response.json()).toStrictEqual({
      code: 'ESI_UNAVAILABLE',
      message: 'Employment history is temporarily unavailable.',
    })
  })

  test('exposes stale employment metadata at the response root', async () => {
    mocks.getCharacterEmploymentHistory.mockResolvedValue({
      cachedUntil: '2026-09-01T10:59:00.000Z',
      data: [],
      quota: {},
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:07:00.000Z',
      source: 'cache',
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
    })

    const response = await authorizedRequest(`/${altCharacter.characterId}/history`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      cachedUntil: '2026-09-01T10:59:00.000Z',
      characterId: altCharacter.characterId,
      history: [],
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-09-01T11:07:00.000Z',
      stale: true,
      validatedAt: '2026-09-01T10:58:00.000Z',
    })
  })

  test('maps employment history cooldowns to a retryable response', async () => {
    mocks.getCharacterEmploymentHistory.mockRejectedValue(new EsiQuotaError(12))

    const response = await authorizedRequest(`/${altCharacter.characterId}/history`)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('12')
    expect(await response.json()).toStrictEqual({
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
    expect(await response.json()).toStrictEqual({
      mainCharacter: { ...altCharacter, isMain: true },
    })
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
  test('preserves the mounted AppType deletion contract', () => {
    expectTypeOf<DeleteCharacterRequest['param']>().toEqualTypeOf<{ characterId: string }>()
  })

  test('registers every composed method and path once', () => {
    const routeCounts = new Map<string, number>()
    for (const routeEntry of characterRoutes.routes.filter((entry) => entry.handler.length < 2)) {
      const key = `${routeEntry.method} ${routeEntry.path}`
      routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1)
    }

    expect([...routeCounts.entries()].filter(([, count]) => count > 1)).toStrictEqual([])
    expect(routeCounts.get('DELETE /:characterId')).toBe(1)
  })

  test('deletes an owned non-main character', async () => {
    const response = await mountedAuthorizedRequest(`/${altCharacter.characterId}`, 'DELETE')

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.deleteCharacter).toHaveBeenCalledWith(
      userId,
      altCharacter.characterId,
      altSubjectLifecycleId,
    )
  })

  test.each([
    {
      body: {
        code: 'MAIN_CHARACTER_DELETE_FORBIDDEN',
        message: 'Choose another main character before deleting this one.',
      },
      character: mainCharacter,
      name: 'rejects deletion of the current main character',
      result: 'main-character',
    },
    {
      body: {
        code: 'CHARACTER_AUTHORITY_EVIDENCE_RETAINED',
        message:
          'This character supplies retained organization-owner authority evidence and cannot be deleted.',
      },
      character: altCharacter,
      name: 'retains organization authority evidence',
      result: 'authority-evidence',
    },
    {
      body: {
        code: 'CHARACTER_CORPORATION_SOURCE_ACTIVE',
        message: 'Replace this character as the corporation data source before deleting it.',
      },
      character: altCharacter,
      name: 'retains an active corporation data source',
      result: 'corporation-source',
    },
    {
      body: { code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' },
      character: altCharacter,
      name: 'returns not found when the character disappears during deletion',
      result: 'not-found',
    },
  ])('$name', async ({ character, result, body }) => {
    mocks.findOwnedCharacter.mockResolvedValue(character)
    mocks.deleteCharacter.mockResolvedValue(result)

    const response = await mountedAuthorizedRequest(`/${character.characterId}`, 'DELETE')

    expect(response.status).toBe(result === 'not-found' ? 404 : 409)
    expect(await response.json()).toStrictEqual(body)
  })

  test('returns the same 404 and never deletes a non-owned target', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await mountedAuthorizedRequest('/90000001', 'DELETE')

    expect(response.status).toBe(404)
    expect(mocks.deleteCharacter).not.toHaveBeenCalled()
  })
})

function stalled() {
  return new Promise<never>(() => {})
}

function authorizedRequest(path: string, method = 'GET') {
  return characterRoutes.request(path, {
    headers: { Cookie: 'eve_space_session=active-session' },
    method,
  })
}

function mountedAuthorizedRequest(path: string, method = 'GET') {
  return app.request(`/api/me/characters${path}`, {
    headers: {
      Cookie: 'eve_space_session=active-session',
      Origin: 'http://localhost:3000',
    },
    method,
  })
}

function financeAuthorizeUrl(characterId: number) {
  return `http://localhost:8788/auth/eve/reauthorize/${characterId}?returnTo=%2Fcharacters%2F${characterId}%2Ffinance`
}
