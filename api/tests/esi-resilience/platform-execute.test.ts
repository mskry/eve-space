import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  dispatch: vi.fn(),
  getCharacterAuthorizationForLifecycle: vi.fn(),
  getCharacterCacheAuthorizationForLifecycle: vi.fn(),
  getCharacterWithAuthorization: vi.fn(),
  getPublic: vi.fn(),
  validateInputs: vi.fn(),
}))

vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorizationForLifecycle: mocks.getCharacterCacheAuthorizationForLifecycle,
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({
    getCharacterWithAuthorization: mocks.getCharacterWithAuthorization,
    getPublic: mocks.getPublic,
  }),
}))
vi.mock('../../src/esi-resilience/module-operation-dispatcher.js', () => ({
  dispatchModuleEsiOperation: mocks.dispatch,
  validateModuleEsiOperationInputs: mocks.validateInputs,
}))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({
  createEsiTransport: mocks.createTransport,
}))

import { installedModuleEsiOperationDefinitions } from '../../src/generated/platform/installed-module-esi.js'
import {
  executePlatformEsiOperation,
  PlatformEsiRequestError,
} from '../../src/esi-resilience/platform-execute.js'

const characterId = 1_404_328_063
const lifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
const primaryOperation = 'organization-activity-character-jobs'
const dependentOperation = 'organization-activity-job-participation'

describe('platform ESI execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateInputs.mockImplementation((_definition, inputs) => inputs)
    mocks.createTransport.mockReturnValue(vi.fn())
    mocks.getCharacterAuthorizationForLifecycle.mockResolvedValue({
      accessToken: 'private-token',
      tokenVersion: 5,
    })
    mocks.getCharacterCacheAuthorizationForLifecycle.mockResolvedValue({ tokenVersion: 5 })
    mocks.dispatch.mockResolvedValue({
      data: { freelance_jobs: [{ id: 'job-one' }] },
      meta: { status: 200, headers: {} },
    })
    mocks.getCharacterWithAuthorization.mockImplementation(async (resource, authorization) => {
      await authorization.recheckCacheAuthorization()
      const resolved = await authorization.resolve()
      const loaded = await resource.load(
        { accessToken: resolved.accessToken, principal: authorization.transportPrincipal },
        { ifNoneMatch: 'current-etag' },
      )
      return {
        result: cached(loaded.data),
        authorizationGeneration: resolved.tokenVersion,
      }
    })
  })

  test.each([
    [
      primaryOperation,
      { path: { character_id: characterId } },
      { freelance_jobs: [{ id: 'job-one' }] },
    ],
    [
      dependentOperation,
      { path: { character_id: characterId, job_id: '11111111-1111-4111-8111-111111111111' } },
      { contributed: 2, state: 'Committed' },
    ],
  ] as const)(
    'executes raw installed operation %s with lifecycle authority',
    async (operation, inputs, raw) => {
      const definition = installedModuleEsiOperationDefinitions[operation]
      mocks.dispatch.mockResolvedValueOnce({ data: raw, meta: { status: 200, headers: {} } })

      await expect(
        executePlatformEsiOperation({
          operation,
          definition,
          inputs,
          authorization: {
            kind: 'character-lifecycle',
            characterId,
            lifecycleId,
            generation: 4,
          },
        }),
      ).resolves.toEqual({
        ...cached(raw),
        authorizationGeneration: 5,
      })
      expect(mocks.getCharacterWithAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ operation, inputs }),
        expect.objectContaining({
          cacheAuthorization: {
            kind: 'character',
            principal: `character-${characterId}-lifecycle-${lifecycleId}`,
            generation: 4,
          },
          transportPrincipal: `character-${characterId}`,
        }),
      )
      expect(mocks.getCharacterAuthorizationForLifecycle).toHaveBeenCalledWith(
        characterId,
        lifecycleId,
        'esi-characters.read_freelance_jobs.v1',
      )
      expect(mocks.getCharacterCacheAuthorizationForLifecycle).toHaveBeenCalledWith(
        characterId,
        lifecycleId,
        'esi-characters.read_freelance_jobs.v1',
      )
      expect(mocks.dispatch).toHaveBeenCalledWith(definition, {
        inputs,
        authorization: { kind: 'character', accessToken: 'private-token' },
        revalidation: { ifNoneMatch: 'current-etag' },
        transport: expect.any(Function),
      })
    },
  )

  test('returns a verified cached lifecycle generation without loading token material', async () => {
    mocks.getCharacterWithAuthorization.mockImplementation(async (_resource, authorization) => ({
      result: cached({ freelance_jobs: [] }, 'cache'),
      authorizationGeneration: await authorization.recheckCacheAuthorization(),
    }))

    await expect(
      executePlatformEsiOperation({
        operation: primaryOperation,
        definition: installedModuleEsiOperationDefinitions[primaryOperation],
        inputs: { path: { character_id: characterId } },
        authorization: {
          kind: 'character-lifecycle',
          characterId,
          lifecycleId,
          generation: 4,
        },
      }),
    ).resolves.toMatchObject({ source: 'cache', authorizationGeneration: 5 })
    expect(mocks.getCharacterAuthorizationForLifecycle).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.createTransport).not.toHaveBeenCalled()
  })

  test('returns null generation for public platform operations', async () => {
    const operation = 'organization-activity-campaign-list'
    const definition = installedModuleEsiOperationDefinitions[operation]
    mocks.getPublic.mockImplementation(async (resource) => {
      const loaded = await resource.load({})
      return cached(loaded.data)
    })
    mocks.dispatch.mockResolvedValueOnce({
      data: { campaigns: [] },
      meta: { status: 200, headers: {} },
    })

    await expect(
      executePlatformEsiOperation({
        operation,
        definition,
        inputs: {},
        authorization: { kind: 'public' },
      }),
    ).resolves.toMatchObject({ data: { campaigns: [] }, authorizationGeneration: null })
    expect(mocks.createTransport).toHaveBeenCalledWith(operation)
  })

  test('rejects reserved revalidation headers in validated dynamic inputs', async () => {
    const operation = 'organization-activity-campaign-list'
    const definition = installedModuleEsiOperationDefinitions[operation]
    mocks.validateInputs.mockReturnValue({ headers: { 'IF-MODIFIED-SINCE': 'caller-value' } })

    const execution = executePlatformEsiOperation({
      operation,
      definition,
      inputs: { headers: { 'IF-MODIFIED-SINCE': 'caller-value' } },
      authorization: { kind: 'public' },
    })

    await expect(execution).rejects.toBeInstanceOf(PlatformEsiRequestError)
    await expect(execution).rejects.toHaveProperty(
      'cause.message',
      'ESI request header IF-MODIFIED-SINCE is executor-owned',
    )
    expect(mocks.getPublic).not.toHaveBeenCalled()
  })
})

function cached(data: unknown, source: 'esi' | 'cache' = 'esi') {
  return {
    data,
    cachedUntil: '2026-09-10T12:01:00.000Z',
    validatedAt: '2026-09-10T12:00:00.000Z',
    source,
    stale: false,
    quota: {},
  }
}
