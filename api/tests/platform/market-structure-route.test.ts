import { marketStructureRoutes } from '@eve-space/market-server'
import { Hono } from 'hono'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isInstalledModuleContributionEnabled: vi.fn(),
  findSession: vi.fn(),
  findOwnedCharacter: vi.fn(),
  authorizeOrganizationContribution: vi.fn(),
  currentGeneration: vi.fn(),
  request: vi.fn(),
}))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: mocks.isInstalledModuleContributionEnabled,
}))
vi.mock('../../src/auth/session-store.js', () => ({ findSession: mocks.findSession }))
vi.mock('../../src/auth/character-lifecycle.js', () => ({
  findOwnedCharacter: mocks.findOwnedCharacter,
}))
vi.mock('../../src/middleware/organization-session.js', () => ({
  loadOrganizationSession: async (
    context: {
      set(
        key: string,
        value: {
          blocked: boolean
          state: 'compliant'
          evidenceFreshness: 'fresh'
          organizationVersion: number
          accessValidUntil: Date
          reviewDeadline: null
        },
      ): void
    },
    next: () => Promise<void>,
  ) => {
    context.set('organization', {
      blocked: false,
      state: 'compliant',
      evidenceFreshness: 'fresh',
      organizationVersion: 7,
      accessValidUntil: new Date(Date.now() + 60_000),
      reviewDeadline: null,
    })
    await next()
  },
}))
vi.mock('../../src/organization/module-authorization.js', () => ({
  authorizeOrganizationContribution: mocks.authorizeOrganizationContribution,
  authorizeOrganizationReviewerContribution: vi.fn(),
}))
vi.mock('../../src/platform/module-collection-status-capabilities.js', () => ({
  createPlatformModuleCollectionStatusReads: vi.fn(() => ({ read: vi.fn() })),
}))
vi.mock('../../src/platform/core-read-capabilities.js', () => ({
  createOwnedCharacterCoreReads: vi.fn(() => ({ loadAffiliation: vi.fn() })),
}))

import { platformModuleRouteComposers } from '../../src/platform/module-route-composition.js'

const characterId = 90000001
const lifecycleId = '00000000-0000-4000-8000-000000000001'
const structureId = 1020000000000
const readStructureBook = vi.fn()
const reserveStructureDemand = vi.fn()
const releaseStructureDemand = vi.fn()
const route = marketStructureRoutes({
  coreData: {},
  persistence: { readStructureBook, reserveStructureDemand, releaseStructureDemand },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
})
const onDemand = { currentGeneration: mocks.currentGeneration, request: mocks.request }
const app = new Hono().route(
  '/api/modules/market/characters/:characterId',
  platformModuleRouteComposers['owned-character'](
    'market',
    {
      publisherPackage: '@eve-space/market-manifest',
      moduleId: 'market',
      audience: 'member',
      requiredPermission: 'market.structure.read',
    },
    route,
    onDemand,
  ),
)
const path = `/api/modules/market/characters/${characterId}/structures/${structureId}/types/34/orders?side=sell`
const cookie = 'eve_space_session=session-token'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(true)
  mocks.findSession.mockResolvedValue({ userId: '00000000-0000-4000-8000-000000000002' })
  mocks.findOwnedCharacter.mockResolvedValue({ characterId, subjectLifecycleId: lifecycleId })
  mocks.authorizeOrganizationContribution.mockResolvedValue({
    authorized: true,
    context: {
      organizationVersion: 7,
      audience: 'member',
      requiredPermission: 'market.structure.read',
      entitlementScope: 'all',
    },
  })
  mocks.currentGeneration.mockResolvedValue(4)
  mocks.request.mockResolvedValue('accepted')
  readStructureBook.mockResolvedValue(null)
  reserveStructureDemand.mockResolvedValue({ outcome: 'reserved' })
  releaseStructureDemand.mockResolvedValue({ outcome: 'released' })
})

test('gates private structure rows by session, organization permission, ownership and scope', async () => {
  expect((await app.request(path)).status).toBe(401)
  expect(readStructureBook).not.toHaveBeenCalled()

  mocks.authorizeOrganizationContribution.mockResolvedValueOnce({
    authorized: false,
    reason: 'permission',
  })
  expect((await app.request(path, { headers: { cookie } })).status).toBe(403)
  expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()

  mocks.findOwnedCharacter.mockResolvedValueOnce(null)
  expect((await app.request(path, { headers: { cookie } })).status).toBe(404)
  expect(readStructureBook).not.toHaveBeenCalled()

  mocks.currentGeneration.mockResolvedValueOnce(null)
  expect((await app.request(path, { headers: { cookie } })).status).toBe(409)
  expect(readStructureBook).not.toHaveBeenCalled()

  const response = await app.request(path, { headers: { cookie } })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(await response.json()).toStrictEqual({ status: 'uncollected' })
  expect(readStructureBook).toHaveBeenCalledWith(
    expect.objectContaining({
      characterId,
      subjectLifecycleId: lifecycleId,
      authorizationGeneration: 4,
      organizationVersion: 7,
      structureId,
    }),
  )
})

test('disabled Market blocks private handlers before session or persistence reads', async () => {
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
  expect((await app.request(path, { headers: { cookie } })).status).toBe(404)
  expect(mocks.findSession).not.toHaveBeenCalled()
  expect(readStructureBook).not.toHaveBeenCalled()
  expect(reserveStructureDemand).not.toHaveBeenCalled()
})
