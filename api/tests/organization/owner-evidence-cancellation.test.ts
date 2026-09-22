import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  observeAndPersistAffiliation: vi.fn(),
  getRoles: vi.fn(),
  transaction: vi.fn(),
}))

const candidate = vi.hoisted(
  () =>
    ({
      grantId: '98a782d2-e042-47d7-9659-03b218121a1a',
      organizationVersion: 4,
      sourceSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
      authorizationGeneration: 3,
      roleEvidenceRevision: '2026-09-21T12:00:00.000Z',
    }) as const,
)

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'limit'])
    builder[method] = vi.fn(() => builder)
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

vi.mock('../../src/db/client.js', () => {
  const snapshot = {
    organizationType: 'corporation',
    organizationId: 98_000_001,
    organizationVersion: 4,
    userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    characterId: 1_404_328_063,
    grantId: candidate.grantId,
    sourceSubjectLifecycleId: candidate.sourceSubjectLifecycleId,
    currentSubjectLifecycleId: candidate.sourceSubjectLifecycleId,
    authorizationGeneration: candidate.authorizationGeneration,
    currentAuthorizationGeneration: candidate.authorizationGeneration,
    roleEvidenceRevision: candidate.roleEvidenceRevision,
  }
  return {
    db: {
      select: vi
        .fn()
        .mockReturnValueOnce(query([snapshot]))
        .mockImplementation(() => query([])),
      transaction: mocks.transaction,
    },
  }
})
vi.mock('../../src/characters/affiliation-sync.js', () => ({
  observeAndPersistCharacterAffiliation: mocks.observeAndPersistAffiliation,
}))
vi.mock('../../src/characters/corporation-roles.js', () => ({
  getCharacterCorporationRolesEvidence: mocks.getRoles,
}))

import { refreshOrganizationOwnerEvidence } from '../../src/organization/owner-evidence.js'

describe('organization owner evidence cancellation', () => {
  test('does not persist degradation or revoke authority after ESI cancellation', async () => {
    const controller = new AbortController()
    mocks.observeAndPersistAffiliation.mockImplementation(
      (_characterId: number, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    const pending = refreshOrganizationOwnerEvidence(candidate, { signal: controller.signal })
    await vi.waitFor(() => expect(mocks.observeAndPersistAffiliation).toHaveBeenCalledOnce())
    controller.abort()

    await expect(pending).rejects.toBe(controller.signal.reason)
    expect(mocks.getRoles).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
