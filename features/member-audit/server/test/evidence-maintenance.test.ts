import { expect, test, vi } from 'vitest'
import type { EvidenceMaintenancePersistence } from '../src/persistence.js'
import { trainedSkillsResource } from '../src/skill-resources.js'
import { walletBalanceResource } from '../src/wallet-resources.js'
import { maintenanceContext, subject } from './resource-test-fixtures.js'

test('purges expired and invalid-authority evidence in bounded batches', async () => {
  const purgeEvidence = vi.fn().mockResolvedValue({ deleted: 0, remaining: false })
  const persistence: EvidenceMaintenancePersistence = { purgeEvidence }
  const invalidAuthority = {
    authorizationGeneration: 8,
    characterId: subject.characterId,
    characterLifecycleId: subject.lifecycleId,
    disclosureVersion: 2,
    managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
    organizationVersion: 4,
    sectionActivationVersion: 3,
    targetUserId: '22222222-2222-4222-8222-222222222222',
  }
  const context = {
    ...maintenanceContext(persistence),
    invalidAuthorities: [invalidAuthority],
    purgeRetention: true,
  }

  await trainedSkillsResource.maintain?.(context)

  expect(purgeEvidence).toHaveBeenCalledTimes(8)
  expect(purgeEvidence).toHaveBeenCalledWith({
    cutoff: '2026-09-17T10:00:00.000Z',
    limit: 1000,
    mode: 'retention',
    store: 'continuations',
  })
  expect(purgeEvidence).toHaveBeenCalledWith({
    mode: 'authority',
    store: 'trained-skills',
    ...invalidAuthority,
    limit: 1000,
  })
  purgeEvidence.mockClear()
  await walletBalanceResource.maintain?.(context)
  expect(purgeEvidence).toHaveBeenCalledOnce()
  expect(purgeEvidence).toHaveBeenCalledWith({
    mode: 'authority',
    store: 'wallet-balance',
    ...invalidAuthority,
    limit: 1000,
  })

  purgeEvidence.mockClear()
  await trainedSkillsResource.maintain?.({
    ...context,
    invalidAuthorities: [],
    purgeAccountIds: [invalidAuthority.targetUserId],
    purgeRetention: false,
  })
  expect(purgeEvidence).toHaveBeenCalledOnce()
  expect(purgeEvidence).toHaveBeenCalledWith({
    limit: 1000,
    mode: 'account',
    store: 'trained-skills',
    targetUserId: invalidAuthority.targetUserId,
  })
})
