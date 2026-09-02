import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  current: [] as unknown[],
  actorCompliance: [] as unknown[],
  updated: [] as unknown[],
  authority: vi.fn(),
  appendAudit: vi.fn(),
  recomputeAll: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: { transaction: mocks.transaction },
}))
vi.mock('../../src/organization/audit.js', () => ({
  appendOrganizationAuditEvent: mocks.appendAudit,
}))
vi.mock('../../src/organization/compliance.js', () => ({
  recomputeAllOrganizationAccountsInTransaction: mocks.recomputeAll,
}))
vi.mock('../../src/organization/role-store.js', () => ({
  hasCurrentOrganizationOwnerAuthorityInTransaction: mocks.authority,
}))

import {
  OrganizationRegistrationPolicyMutationError,
  updateOrganizationRegistrationPolicy,
} from '../../src/organization/policy-store.js'

const actorUserId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'

describe('organization registration policy store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.current = [settings()]
    mocks.actorCompliance = [{ state: 'compliant' }]
    mocks.updated = []
    mocks.authority.mockResolvedValue(true)
    mocks.appendAudit.mockResolvedValue(undefined)
    mocks.recomputeAll.mockResolvedValue(undefined)
    mocks.transaction.mockImplementation(async (operation) => operation(transaction()))
  })

  test('normalizes, versions, audits, and recomputes a changed policy atomically', async () => {
    mocks.updated = [
      settings({
        registrationPolicyVersion: 4,
        requiredRegistrationScopes: ['scope-a', 'scope-b'],
        strictRemediationDurationSeconds: 7200,
        staleEvidenceGraceDurationSeconds: 1800,
      }),
    ]

    await expect(
      updateOrganizationRegistrationPolicy({
        actorUserId,
        requiredScopes: [' scope-b ', 'scope-a', 'scope-a'],
        strictRemediationDurationSeconds: 7200,
        staleEvidenceGraceDurationSeconds: 1800,
        reason: 'Policy review',
      }),
    ).resolves.toEqual({
      organizationVersion: 8,
      policyVersion: 4,
      requiredScopes: ['scope-a', 'scope-b'],
      strictRemediationDurationSeconds: 7200,
      staleEvidenceGraceDurationSeconds: 1800,
    })
    expect(mocks.appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationVersion: 8,
        policyVersion: 4,
        eventType: 'registration-policy.changed',
        actorId: actorUserId,
        reason: 'Policy review',
      }),
    )
    expect(mocks.recomputeAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deploymentId: 1, organizationVersion: 8 }),
    )
  })

  test('returns an unchanged policy without audit or recomputation', async () => {
    await expect(
      updateOrganizationRegistrationPolicy({
        actorUserId,
        requiredScopes: ['scope-a'],
        strictRemediationDurationSeconds: 3600,
        staleEvidenceGraceDurationSeconds: 900,
        reason: 'No effective change',
      }),
    ).resolves.toMatchObject({ policyVersion: 3, requiredScopes: ['scope-a'] })
    expect(mocks.appendAudit).not.toHaveBeenCalled()
    expect(mocks.recomputeAll).not.toHaveBeenCalled()
  })

  test('requires a configured organization and owner authority', async () => {
    mocks.current = []
    await expect(updateOrganizationRegistrationPolicy(validInput())).rejects.toThrow(
      'Deployment organization is not configured',
    )

    mocks.current = [settings()]
    mocks.authority.mockResolvedValue(false)
    await expect(updateOrganizationRegistrationPolicy(validInput())).rejects.toEqual(
      new OrganizationRegistrationPolicyMutationError('owner-authority-required'),
    )
  })

  test.each([
    { requiredScopes: [''], reason: 'invalid scope' },
    { requiredScopes: ['x'.repeat(201)], reason: 'oversized scope' },
    { strictRemediationDurationSeconds: 1.5, reason: 'fractional strict duration' },
    { strictRemediationDurationSeconds: -1, reason: 'negative strict duration' },
    { strictRemediationDurationSeconds: 30 * 24 * 60 * 60 + 1, reason: 'long strict duration' },
    { staleEvidenceGraceDurationSeconds: 1.5, reason: 'fractional stale duration' },
    { staleEvidenceGraceDurationSeconds: -1, reason: 'negative stale duration' },
    { staleEvidenceGraceDurationSeconds: 24 * 60 * 60 + 1, reason: 'long stale duration' },
    { reason: ' ', label: 'missing reason' },
  ])('rejects invalid policy input: $reason', async (overrides) => {
    await expect(
      updateOrganizationRegistrationPolicy({ ...validInput(), ...overrides }),
    ).rejects.toEqual(new OrganizationRegistrationPolicyMutationError('invalid-policy'))
  })

  test('fails when the locked policy cannot be updated', async () => {
    await expect(updateOrganizationRegistrationPolicy(validInput())).rejects.toThrow(
      'Failed to update organization registration policy',
    )
    expect(mocks.appendAudit).not.toHaveBeenCalled()
  })

  test('rejects a policy that would leave its owner noncompliant', async () => {
    mocks.updated = [settings({ registrationPolicyVersion: 4 })]
    mocks.actorCompliance = [{ state: 'suspended' }]

    await expect(updateOrganizationRegistrationPolicy(validInput())).rejects.toEqual(
      new OrganizationRegistrationPolicyMutationError('owner-policy-noncompliant'),
    )
    expect(mocks.recomputeAll).toHaveBeenCalledOnce()
  })
})

function validInput() {
  return {
    actorUserId,
    requiredScopes: ['scope-b'],
    strictRemediationDurationSeconds: 7200,
    staleEvidenceGraceDurationSeconds: 1800,
    reason: 'Policy review',
  }
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    organizationVersion: 8,
    registrationPolicyVersion: 3,
    requiredRegistrationScopes: ['scope-a'],
    strictRemediationDurationSeconds: 3600,
    staleEvidenceGraceDurationSeconds: 900,
    ...overrides,
  }
}

function transaction() {
  let selection = 0
  return {
    select: vi.fn(() => query(selection++ === 0 ? mocks.current : mocks.actorCompliance)),
    update: vi.fn(() => updateQuery(mocks.updated)),
  }
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'for']) builder[method] = () => builder
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function updateQuery(result: unknown[]) {
  const builder = query(result)
  builder.set = () => builder
  builder.returning = () => builder
  return builder
}
