import { describe, expect, test } from 'vitest'
import { CharacterTokenNotFoundError } from '../../src/auth/store.js'
import { EveSsoTokenRefreshError } from '../../src/auth/sso.js'
import { ScopeRequiredError } from '../../src/auth/tokens.js'
import { OrganizationAuthorityError } from '../../src/organization/authority.js'
import { classifyOrganizationAuthorityFailure } from '../../src/organization/owner-evidence.js'

describe('organization owner evidence failures', () => {
  test.each([
    [new OrganizationAuthorityError('not-director'), 'strict', 'not-director'],
    [new OrganizationAuthorityError('wrong-corporation'), 'strict', 'wrong-corporation'],
    [new ScopeRequiredError('scope'), 'strict', 'missing-scope'],
    [new CharacterTokenNotFoundError(), 'strict', 'authorization-missing'],
    [new EveSsoTokenRefreshError(400, true), 'strict', 'authorization-revoked'],
    [{ code: 'ESI_HTTP_ERROR', status: 403 }, 'strict', 'authorization-rejected'],
  ])('classifies conclusive authority loss', (error, kind, failureClass) => {
    expect(classifyOrganizationAuthorityFailure(error)).toEqual({ kind, failureClass })
  })

  test.each([
    [new OrganizationAuthorityError('stale-affiliation'), 'affiliation-unavailable'],
    [new OrganizationAuthorityError('executor-unavailable'), 'affiliation-unavailable'],
    [new EveSsoTokenRefreshError(503, false), 'sso-unavailable'],
    [{ code: 'ESI_HTTP_ERROR', status: 503 }, 'esi-unavailable'],
  ])('classifies temporary verification failures', (error, failureClass) => {
    expect(classifyOrganizationAuthorityFailure(error)).toEqual({
      kind: 'transient',
      failureClass,
    })
  })

  test('leaves programming and persistence failures retryable by the worker', () => {
    expect(classifyOrganizationAuthorityFailure(new Error('database unavailable'))).toBeNull()
  })
})
