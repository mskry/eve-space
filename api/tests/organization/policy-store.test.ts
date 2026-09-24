import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actorCompliance: [] as unknown[],
  appendAudit: vi.fn(),
  authority: vi.fn(),
  current: [] as unknown[],
  invalidateDerived: vi.fn(),
  recomputeAll: vi.fn(),
  reconcileDeadlines: vi.fn(),
  transaction: vi.fn(),
  updated: [] as unknown[],
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
vi.mock('../../src/organization/authority-convergence.js', () => ({
  invalidateDerivedAuthorityPolicySourcesInTransaction: mocks.invalidateDerived,
  reconcileAuthorityPolicyDeadlinesInTransaction: mocks.reconcileDeadlines,
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
    mocks.invalidateDerived.mockResolvedValue(undefined)
    mocks.reconcileDeadlines.mockResolvedValue(undefined)
    mocks.recomputeAll.mockResolvedValue(undefined)
    mocks.transaction.mockImplementation(async (operation) => operation(transaction()))
  })

  test('normalizes, versions, audits, and recomputes a changed policy atomically', async () => {
    mocks.updated = [
      settings({
        registrationPolicyVersion: 4,
        requiredRegistrationScopes: ['scope-a', 'scope-b'],
        staleEvidenceGraceDurationSeconds: 1800,
        strictRemediationDurationSeconds: 7200,
      }),
    ]

    await expect(
      updateOrganizationRegistrationPolicy({
        actorUserId,
        authorityEvidenceFreshDurationSeconds: 3600,
        derivedDirectorAuthorityEnabled: true,
        reason: 'Policy review',
        requiredScopes: [' scope-b ', 'scope-a', 'scope-a'],
        staleEvidenceGraceDurationSeconds: 1800,
        strictRemediationDurationSeconds: 7200,
      }),
    ).resolves.toStrictEqual({
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      organizationVersion: 8,
      policyVersion: 4,
      requiredScopes: ['scope-a', 'scope-b'],
      staleEvidenceGraceDurationSeconds: 1800,
      strictRemediationDurationSeconds: 7200,
    })
    expect(mocks.appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actorUserId,
        eventType: 'registration-policy.changed',
        organizationVersion: 8,
        policyVersion: 4,
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
        authorityEvidenceFreshDurationSeconds: 3600,
        derivedDirectorAuthorityEnabled: true,
        reason: 'No effective change',
        requiredScopes: ['scope-a'],
        staleEvidenceGraceDurationSeconds: 900,
        strictRemediationDurationSeconds: 3600,
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
    await expect(updateOrganizationRegistrationPolicy(validInput())).rejects.toStrictEqual(
      new OrganizationRegistrationPolicyMutationError('owner-authority-required'),
    )
  })

  test.each([
    { reason: 'invalid scope', requiredScopes: [''] },
    { reason: 'oversized scope', requiredScopes: ['x'.repeat(201)] },
    { reason: 'fractional strict duration', strictRemediationDurationSeconds: 1.5 },
    { reason: 'negative strict duration', strictRemediationDurationSeconds: -1 },
    { reason: 'long strict duration', strictRemediationDurationSeconds: 30 * 24 * 60 * 60 + 1 },
    { reason: 'fractional stale duration', staleEvidenceGraceDurationSeconds: 1.5 },
    { reason: 'negative stale duration', staleEvidenceGraceDurationSeconds: -1 },
    { reason: 'long stale duration', staleEvidenceGraceDurationSeconds: 24 * 60 * 60 + 1 },
    { authorityEvidenceFreshDurationSeconds: 1.5, reason: 'fractional authority duration' },
    { authorityEvidenceFreshDurationSeconds: 299, reason: 'short authority duration' },
    { authorityEvidenceFreshDurationSeconds: 86_401, reason: 'long authority duration' },
    { label: 'missing reason', reason: ' ' },
  ])('rejects invalid policy input: $reason', async (overrides) => {
    await expect(
      updateOrganizationRegistrationPolicy({ ...validInput(), ...overrides }),
    ).rejects.toStrictEqual(new OrganizationRegistrationPolicyMutationError('invalid-policy'))
  })

  test('fails when the locked policy cannot be updated', async () => {
    await expect(updateOrganizationRegistrationPolicy(validInput())).rejects.toThrow(
      'Failed to update organization registration policy',
    )
    expect(mocks.appendAudit).not.toHaveBeenCalled()
  })

  test('invalidates derived sources and reconciles shortened evidence windows', async () => {
    mocks.updated = [
      settings({
        authorityEvidenceFreshDurationSeconds: 1800,
        derivedDirectorAuthorityEnabled: false,
        registrationPolicyVersion: 4,
        staleEvidenceGraceDurationSeconds: 600,
      }),
    ]

    await updateOrganizationRegistrationPolicy({
      ...validInput(),
      authorityEvidenceFreshDurationSeconds: 1800,
      derivedDirectorAuthorityEnabled: false,
      staleEvidenceGraceDurationSeconds: 600,
    })

    expect(mocks.invalidateDerived).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationVersion: 8 }),
    )
    expect(mocks.reconcileDeadlines).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        freshDurationSeconds: 1800,
        organizationVersion: 8,
        policyVersion: 4,
        staleGraceDurationSeconds: 600,
      }),
    )
  })

  test('rejects a policy that would leave its owner noncompliant', async () => {
    mocks.updated = [settings({ registrationPolicyVersion: 4 })]
    mocks.actorCompliance = [{ state: 'suspended' }]

    await expect(updateOrganizationRegistrationPolicy(validInput())).rejects.toStrictEqual(
      new OrganizationRegistrationPolicyMutationError('owner-policy-noncompliant'),
    )
    expect(mocks.recomputeAll).toHaveBeenCalledOnce()
  })

  test('rolls back a policy that expires the acting owner source', async () => {
    mocks.updated = [
      settings({
        authorityEvidenceFreshDurationSeconds: 1800,
        registrationPolicyVersion: 4,
      }),
    ]
    mocks.authority.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(
      updateOrganizationRegistrationPolicy({
        ...validInput(),
        authorityEvidenceFreshDurationSeconds: 1800,
      }),
    ).rejects.toStrictEqual(
      new OrganizationRegistrationPolicyMutationError('owner-policy-noncompliant'),
    )
    expect(mocks.appendAudit).not.toHaveBeenCalled()
    expect(mocks.recomputeAll).not.toHaveBeenCalled()
  })
})

function validInput() {
  return {
    actorUserId,
    authorityEvidenceFreshDurationSeconds: 3600,
    derivedDirectorAuthorityEnabled: true,
    reason: 'Policy review',
    requiredScopes: ['scope-b'],
    staleEvidenceGraceDurationSeconds: 1800,
    strictRemediationDurationSeconds: 7200,
  }
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    authorityEvidenceFreshDurationSeconds: 3600,
    derivedDirectorAuthorityEnabled: true,
    organizationVersion: 8,
    registrationPolicyVersion: 3,
    requiredRegistrationScopes: ['scope-a'],
    staleEvidenceGraceDurationSeconds: 900,
    strictRemediationDurationSeconds: 3600,
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
  for (const method of ['from', 'where', 'for']) {
    builder[method] = () => builder
  }
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
