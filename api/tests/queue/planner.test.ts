import { expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  affiliation: vi.fn(),
  allianceExecutor: vi.fn(),
  corporationRoles: vi.fn(),
  groupRules: vi.fn(),
  maintenance: vi.fn(),
  repairCollection: vi.fn(),
  repairCompliance: vi.fn(),
  resources: vi.fn(),
}))

vi.mock('../../src/queue/affiliation-planner.js', () => ({
  runAffiliationPlanner: mocks.affiliation,
}))
vi.mock('../../src/queue/corporation-role-planner.js', () => ({
  runCorporationRolePlanner: mocks.corporationRoles,
}))
vi.mock('../../src/queue/alliance-executor-planner.js', () => ({
  runAllianceExecutorPlanner: mocks.allianceExecutor,
}))
vi.mock('../../src/queue/group-rule-planner.js', () => ({
  runGroupRulePlanner: mocks.groupRules,
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

  expect(mocks.corporationRoles).toHaveBeenCalledOnce()
  expect(mocks.corporationRoles).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  expect(mocks.allianceExecutor).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  expect(mocks.groupRules).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  expect(mocks.maintenance).toHaveBeenCalledWith({ signal })
  expect(mocks.repairCollection.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.maintenance.mock.invocationCallOrder[0]!,
  )
  expect(mocks.maintenance.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.resources.mock.invocationCallOrder[0]!,
  )
})
