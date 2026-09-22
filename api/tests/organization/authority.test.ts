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
        { organizationType: 'corporation', organizationId: corporationId },
        { corporationId, allianceId: null },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test('requires alliance claimants to belong to the current executor corporation', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get.mock.calls[0]?.[1]).toEqual({ allianceId })
  })

  test('rejects a corporation outside the managed organization authority', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'corporation', organizationId: corporationId },
        { corporationId: corporationId + 1, allianceId: null },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('wrong-corporation'))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId: corporationId + 1, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('wrong-corporation'))
  })

  test('rejects a character outside the managed alliance before executor lookup', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId: allianceId + 1 },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('wrong-alliance'))
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
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('stale-affiliation'))
  })

  test('treats an alliance without a current executor as unavailable evidence', async () => {
    mocks.get.mockResolvedValueOnce(response({ name: 'Alliance' }))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('executor-unavailable'))
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
    expect(evaluateDerivedDirectorSource(derivedSource(), now)).toEqual({
      state: 'fresh',
      eligible: true,
      failure: null,
    })
    expect(
      evaluateDerivedDirectorSource(
        derivedSource({ scopes: [], roles: { roles: ['Director'] } }),
        now,
      ),
    ).toMatchObject({ state: 'invalid', failure: 'missing-scope' })
    expect(
      evaluateDerivedDirectorSource(
        derivedSource({ scopes: [requiredScope], roles: { roles: ['Accountant'] } }),
        now,
      ),
    ).toMatchObject({ state: 'invalid', failure: 'not-director' })
  })

  test('unions independent qualifying sources without creating authority from partial sources', () => {
    const decisions = [
      evaluateDerivedDirectorSource(derivedSource({ scopes: [] }), now),
      evaluateDerivedDirectorSource(derivedSource({ roles: { roles: [] } }), now),
    ]
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        sourceStates: decisions.filter(({ eligible }) => eligible).map(({ state }) => state),
        operation: 'mutate',
      }),
    ).toBe(false)

    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        sourceStates: ['invalid', 'fresh'],
        operation: 'mutate',
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        sourceStates: ['fresh', 'fresh'],
        operation: 'mutate',
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        sourceStates: [],
        operation: 'mutate',
      }),
    ).toBe(false)
  })

  test('keeps explicit grants independent and restricts degraded evidence to continuity', () => {
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: true,
        sourceStates: ['invalid'],
        operation: 'mutate',
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        sourceStates: ['degraded'],
        operation: 'read-continuity',
      }),
    ).toBe(true)
    expect(
      hasEffectiveDirectorAuthority({
        explicitGrant: false,
        sourceStates: ['degraded'],
        operation: 'mutate',
      }),
    ).toBe(false)
  })

  test('requires an alliance source to belong to its executor corporation', () => {
    expect(
      evaluateDerivedDirectorSource(
        derivedSource({
          organization: { organizationType: 'alliance', organizationId: allianceId },
          authorityCorporationId: corporationId,
          affiliation: { corporationId: corporationId + 1, allianceId },
        }),
        now,
      ),
    ).toMatchObject({ state: 'invalid', failure: 'wrong-corporation' })
  })

  test('treats freshness and grace deadlines as exclusive boundaries', () => {
    expect(
      resolveAuthorityEvidenceState(
        {
          status: 'fresh',
          freshUntil: now,
          graceUntil: null,
          invalidatedAt: null,
        },
        now,
      ),
    ).toBe('invalid')
    expect(
      resolveAuthorityEvidenceState(
        {
          status: 'degraded',
          freshUntil: new Date(now.getTime() - 1),
          graceUntil: new Date(now.getTime() + 1),
          invalidatedAt: null,
        },
        now,
      ),
    ).toBe('degraded')
    expect(
      resolveAuthorityEvidenceState(
        {
          status: 'degraded',
          freshUntil: new Date(now.getTime() - 2),
          graceUntil: now,
          invalidatedAt: null,
        },
        now,
      ),
    ).toBe('invalid')
  })
})

function response<Data>(data: Data) {
  return { data, cachedUntil: '', validatedAt: '', quota: {}, source: 'esi' as const, stale: false }
}

function derivedSource(
  overrides: Partial<DerivedDirectorSourcePredicate> = {},
): DerivedDirectorSourcePredicate {
  return {
    enabled: true,
    organization: { organizationType: 'corporation', organizationId: corporationId },
    authorityCorporationId: corporationId,
    affiliation: { corporationId, allianceId: null },
    requiredScope,
    scopes: [requiredScope],
    roles: { roles: ['Director'] },
    lifecycleCurrent: true,
    authorizationGenerationCurrent: true,
    blocked: false,
    evidence: {
      status: 'fresh',
      freshUntil: new Date('2026-09-21T13:00:00.000Z'),
      graceUntil: null,
      invalidatedAt: null,
    },
    ...overrides,
  }
}
