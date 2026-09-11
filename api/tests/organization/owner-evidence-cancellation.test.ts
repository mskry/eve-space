import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAffiliation: vi.fn(),
  getRoles: vi.fn(),
  persistAffiliations: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => {
  const snapshot = {
    organizationType: 'corporation',
    organizationId: 98_000_001,
    organizationVersion: 4,
    characterId: 1_404_328_063,
  }
  const query: Record<string, unknown> = {}
  query.from = vi.fn(() => query)
  query.innerJoin = vi.fn(() => query)
  query.where = vi.fn().mockResolvedValue([snapshot])
  return {
    db: {
      select: vi.fn(() => query),
      transaction: mocks.transaction,
    },
  }
})
vi.mock('../../src/characters/affiliation-sync.js', () => ({
  getCharacterAffiliationObservation: mocks.getAffiliation,
  persistAffiliationObservations: mocks.persistAffiliations,
}))
vi.mock('../../src/characters/corporation-roles.js', () => ({
  getCharacterCorporationRoles: mocks.getRoles,
}))

import { refreshOrganizationOwnerEvidence } from '../../src/organization/owner-evidence.js'

describe('organization owner evidence cancellation', () => {
  test('does not persist degradation or revoke authority after ESI cancellation', async () => {
    const controller = new AbortController()
    mocks.getAffiliation.mockImplementation(
      (_characterId: number, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    const pending = refreshOrganizationOwnerEvidence('grant-id', { signal: controller.signal })
    await vi.waitFor(() => expect(mocks.getAffiliation).toHaveBeenCalledOnce())
    controller.abort()

    await expect(pending).rejects.toBe(controller.signal.reason)
    expect(mocks.persistAffiliations).not.toHaveBeenCalled()
    expect(mocks.getRoles).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
