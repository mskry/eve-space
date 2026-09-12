import { describe, expect, test } from 'vitest'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../../src/auth/token-errors.js'
import { classifyCharacterResourceFailure } from '../../src/characters/resource-failure.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'

const configuredScope = 'esi-configured.scope.v1'

describe('character resource failure classifier', () => {
  test('retains cooldown retry timing', () => {
    expect(classifyCharacterResourceFailure(new EsiQuotaError(17), { configuredScope })).toEqual({
      kind: 'cooldown',
      retryAfterSeconds: 17,
    })
  })

  test('classifies token refresh unavailability', () => {
    expect(
      classifyCharacterResourceFailure(new TokenRefreshUnavailableError(), { configuredScope }),
    ).toEqual({ kind: 'token-refresh-unavailable' })
  })

  test.each([
    {
      name: 'reported scope by default',
      preferConfiguredScope: undefined,
      requiredScope: 'esi-reported.scope.v1',
    },
    {
      name: 'configured scope when preferred',
      preferConfiguredScope: true,
      requiredScope: configuredScope,
    },
  ])('selects the $name', ({ preferConfiguredScope, requiredScope }) => {
    expect(
      classifyCharacterResourceFailure(new ScopeRequiredError('esi-reported.scope.v1'), {
        configuredScope,
        preferConfiguredScope,
      }),
    ).toEqual({ kind: 'scope-required', requiredScope })
  })

  test.each([401, 403, '401', '403'])('extracts HTTP-like authorization status %s', (status) => {
    expect(
      classifyCharacterResourceFailure(Object.assign(new Error('rejected'), { status }), {
        configuredScope,
      }),
    ).toEqual({ kind: 'authorization-rejected', requiredScope: configuredScope })
  })

  test.each([
    new Error('unknown'),
    Object.assign(new Error('upstream failure'), { status: 500 }),
    Object.assign(new Error('invalid status'), { status: 'not-a-status' }),
  ])('classifies unknown failures as unavailable', (error) => {
    expect(classifyCharacterResourceFailure(error, { configuredScope })).toEqual({
      kind: 'unavailable',
    })
  })
})
