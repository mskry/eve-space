import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  get: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () => createFeatureExecutionMock(mocks.get))

import { resolveOrganizationAuthorityCorporation } from '../../src/organization/authority.js'
import {
  assertOrganizationOwnerAuthorization,
  evaluateDerivedDirectorSource,
  hasEffectiveDirectorAuthority,
  OrganizationAuthorityError,
  resolveAuthorityEvidenceState,
  type DerivedDirectorSourcePredicate,
} from '../../src/organization/authority-policy.js'

const requiredScope = 'esi-characters.read_corporation_roles.v1'
const corporationId = 98_000_001
const allianceId = 99_000_001

beforeEach(() => {
  mocks.get.mockImplementation(() =>
    response({ executorCorporationId: corporationId, name: 'Alliance' }),
  )
})

describe('organization owner authority', () => {
  test('accepts fresh affiliation with the managed corporation', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationId: corporationId, organizationType: 'corporation' },
        { allianceId: null, corporationId },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test('requires alliance claimants to belong to the current executor corporation', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationId: allianceId, organizationType: 'alliance' },
        { allianceId, corporationId },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get.mock.calls[0]?.[1]).toStrictEqual({ allianceId })
  })

  test('rejects a corporation outside the managed organization authority', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationId: corporationId, organizationType: 'corporation' },
        { allianceId: null, corporationId: corporationId + 1 },
      ),
    ).rejects.toStrictEqual(new OrganizationAuthorityError('wrong-corporation'))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationId: allianceId, organizationType: 'alliance' },
        { allianceId, corporationId: corporationId + 1 },
      ),
    ).rejects.toStrictEqual(new OrganizationAuthorityError('wrong-corporation'))
  })

  test('rejects a character outside the managed alliance before executor lookup', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationId: allianceId, organizationType: 'alliance' },
        { allianceId: allianceId + 1, corporationId },
      ),
    ).rejects.toStrictEqual(new OrganizationAuthorityError('wrong-alliance'))
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test('rejects stale alliance executor evidence', async () => {
    mocks.get.mockImplementationOnce(() => ({
      ...response({ executorCorporationId: corporationId, name: 'Alliance' }),
      source: 'cache',
      stale: true,
    }))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationId: allianceId, organizationType: 'alliance' },
        { allianceId, corporationId },
      ),
    ).rejects.toStrictEqual(new OrganizationAuthorityError('stale-affiliation'))
  })

  test('treats an alliance without a current executor as unavailable evidence', async () => {
    mocks.get.mockResolvedValueOnce(response({ name: 'Alliance' }))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationId: allianceId, organizationType: 'alliance' },
        { allianceId, corporationId },
      ),
    ).rejects.toStrictEqual(new OrganizationAuthorityError('executor-unavailable'))
  })

  test('requires the corporation-role scope and current Director role', async () => {
    const roles = {
      roles: ['Director'],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    }

    expect(() =>
      assertOrganizationOwnerAuthorization(requiredScope, [requiredScope], roles),
    ).not.toThrow()
    expect(() => assertOrganizationOwnerAuthorization(requiredScope, [], roles)).toThrow(
      new OrganizationAuthorityError('missing-scope'),
    )
    expect(() =>
      assertOrganizationOwnerAuthorization(requiredScope, [requiredScope], {
        ...roles,
        roles: ['Accountant'],
      }),
    ).toThrow(new OrganizationAuthorityError('not-director'))
  })
})

describe('derived Director authority policy', () => {
  const now = new Date('2026-09-21T12:00:00.000Z')

  test('accepts only a complete predicate from one current character source', () => {
    expect(evaluateDerivedDirectorSource(derivedSource(), now)).toStrictEqual({
      eligible: true,
      failure: null,
      state: 'fresh',
    })
    expect(
      evaluateDerivedDirectorSource(
        derivedSource({ roles: { roles: ['Director'] }, scopes: [] }),
        now,
      ),
    ).toMatchObject({ failure: 'missing-scope', state: 'invalid' })
    expect(
      evaluateDerivedDirectorSource(
        derivedSource({ roles: { roles: ['Accountant'] }, scopes: [requiredScope] }),
        now,
      ),
    ).toMatchObject({ failure: 'not-director', state: 'invalid' })
  })

  test('unions independent qualifying sources without creating authority from partial sources', () => {
    const decisions = [
      evaluateDerivedDirectorSource(derivedSource({ scopes: [] }), now),
      evaluateDerivedDirectorSource(derivedSource({ roles: { roles: [] } }), now),
    ]
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        operation: 'mutate',
        sourceStates: decisions.filter(({ eligible }) => eligible).map(({ state }) => state),
      }),
    ).toBe(false)

    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        operation: 'mutate',
        sourceStates: ['invalid', 'fresh'],
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        operation: 'mutate',
        sourceStates: ['fresh', 'fresh'],
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        operation: 'mutate',
        sourceStates: [],
      }),
    ).toBe(false)
  })

  test('keeps explicit grants independent and restricts degraded evidence to continuity', () => {
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: true,
        operation: 'mutate',
        sourceStates: ['invalid'],
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        operation: 'read-continuity',
        sourceStates: ['degraded'],
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        operation: 'mutate',
        sourceStates: ['degraded'],
      }),
    ).toBe(false)
  })

  test('requires an alliance source to belong to its executor corporation', () => {
    expect(
      evaluateDerivedDirectorSource(
        derivedSource({
          affiliation: { allianceId, corporationId: corporationId + 1 },
          authorityCorporationId: corporationId,
          organization: { organizationId: allianceId, organizationType: 'alliance' },
        }),
        now,
      ),
    ).toMatchObject({ failure: 'wrong-corporation', state: 'invalid' })
  })

  test('treats freshness and grace deadlines as exclusive boundaries', () => {
    expect(
      resolveAuthorityEvidenceState(
        {
          freshUntil: now,
          graceUntil: null,
          invalidatedAt: null,
          status: 'fresh',
        },
        now,
      ),
    ).toBe('invalid')
    expect(
      resolveAuthorityEvidenceState(
        {
          freshUntil: new Date(now.getTime() - 1),
          graceUntil: new Date(now.getTime() + 1),
          invalidatedAt: null,
          status: 'degraded',
        },
        now,
      ),
    ).toBe('degraded')
    expect(
      resolveAuthorityEvidenceState(
        {
          freshUntil: new Date(now.getTime() - 2),
          graceUntil: now,
          invalidatedAt: null,
          status: 'degraded',
        },
        now,
      ),
    ).toBe('invalid')
  })
})

function response<Data>(data: Data) {
  return { cachedUntil: '', data, quota: {}, source: 'esi' as const, stale: false, validatedAt: '' }
}

function derivedSource(
  overrides: Partial<DerivedDirectorSourcePredicate> = {},
): DerivedDirectorSourcePredicate {
  return {
    affiliation: { allianceId: null, corporationId },
    authorityCorporationId: corporationId,
    authorizationGenerationCurrent: true,
    blocked: false,
    enabled: true,
    evidence: {
      freshUntil: new Date('2026-09-21T13:00:00.000Z'),
      graceUntil: null,
      invalidatedAt: null,
      status: 'fresh',
    },
    lifecycleCurrent: true,
    organization: { organizationId: corporationId, organizationType: 'corporation' },
    requiredScope,
    roles: { roles: ['Director'] },
    scopes: [requiredScope],
    ...overrides,
  }
}
