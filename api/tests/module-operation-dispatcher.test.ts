import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  clientOptions: vi.fn(),
}))

vi.mock('@evespace/esi-client', () => ({
  EsiClient: class {
    callOperation = mocks.callOperation

    constructor(options: unknown) {
      mocks.clientOptions(options)
    }
  },
}))

import {
  dispatchModuleEsiOperation,
  validateModuleEsiOperationInputs,
} from '../src/esi-resilience/module-operation-dispatcher.js'

describe('module ESI operation dispatcher', () => {
  beforeEach(() => vi.clearAllMocks())

  test('validates projected arguments with the registered SDK descriptor', () => {
    const definition = executableDefinition()

    expect(validateModuleEsiOperationInputs(definition, { path: { character_id: 42 } })).toEqual({
      path: { character_id: 42 },
    })
    expect(definition.descriptor.requestSchema.parse).toHaveBeenCalledOnce()
  })

  test('calls the exact SDK operation once with platform-owned authorization and revalidation', async () => {
    const transport = vi.fn()
    const definition = executableDefinition()
    mocks.callOperation.mockResolvedValue({ data: 10, meta: { status: 200, headers: {} } })

    await expect(
      dispatchModuleEsiOperation(definition, {
        inputs: { path: { character_id: 42 } },
        authorization: { kind: 'character', accessToken: 'secret' },
        revalidation: { ifNoneMatch: 'etag', ifModifiedSince: 'yesterday' },
        transport,
      }),
    ).resolves.toEqual({ data: 10, meta: { status: 200, headers: {} } })

    expect(mocks.clientOptions).toHaveBeenCalledWith({
      fetch: transport,
      token: 'secret',
      validateResponses: true,
    })
    expect(mocks.callOperation).toHaveBeenCalledOnce()
    expect(mocks.callOperation).toHaveBeenCalledWith('GetCharactersCharacterIdWallet', {
      path: { character_id: 42 },
      headers: {
        'If-None-Match': 'etag',
        'If-Modified-Since': 'yesterday',
      },
    })
  })
})

function executableDefinition() {
  const requestSchema = { parse: vi.fn((inputs) => inputs) }
  return {
    sdkOperationId: 'GetCharactersCharacterIdWallet',
    descriptor: {
      requestSchema,
    } as unknown as PlatformExecutableEsiOperationDefinition['descriptor'],
    contract: {
      responseValidation: { kind: 'enabled' },
    } as never,
  } satisfies PlatformExecutableEsiOperationDefinition
}
