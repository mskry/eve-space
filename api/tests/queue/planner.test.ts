import { expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  affiliation: vi.fn(),
  corporationSource: vi.fn(),
  derivedAuthority: vi.fn(),
  maintenance: vi.fn(),
  ownerEvidence: vi.fn(),
  repairCollection: vi.fn(),
  repairCompliance: vi.fn(),
  resources: vi.fn(),
}))

vi.mock('../../src/queue/affiliation-planner.js', () => ({
  runAffiliationPlanner: mocks.affiliation,
}))
vi.mock('../../src/queue/owner-evidence-planner.js', () => ({
  runOrganizationOwnerEvidencePlanner: mocks.ownerEvidence,
}))
vi.mock('../../src/queue/corporation-source-planner.js', () => ({
  runCorporationSourcePlanner: mocks.corporationSource,
}))
vi.mock('../../src/queue/derived-authority-planner.js', () => ({
  runDerivedAuthorityPlanner: mocks.derivedAuthority,
}))
vi.mock('../../src/platform/collection-state-repair.js', () => ({
  repairPlatformCollectionState: mocks.repairCollection,
}))
vi.mock('../../src/platform/resource-maintenance.js', () => ({
  runInstalledResourceMaintenance: mocks.maintenance,
}))
vi.mock('../../src/queue/resource-planner.js', () => ({ runResourcePlanner: mocks.resources }))
vi.mock('../../src/organization/compliance-repair.js', () => ({
  repairOrganizationCompliance: mocks.repairCompliance,
}))

import { runQueuePlanner } from '../../src/queue/planner.js'

test('runs installed resource maintenance from the production planner', async () => {
  const signal = new AbortController().signal
  const producer = { enqueue: vi.fn().mockResolvedValue({ status: 'accepted' }) }

  await runQueuePlanner({ outcomes: {} as never, producer, signal } as never)

  expect(mocks.derivedAuthority).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  expect(mocks.corporationSource).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  expect(mocks.maintenance).toHaveBeenCalledWith({ signal })
  expect(mocks.repairCollection.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.maintenance.mock.invocationCallOrder[0]!,
  )
  expect(mocks.maintenance.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.resources.mock.invocationCallOrder[0]!,
  )
})
