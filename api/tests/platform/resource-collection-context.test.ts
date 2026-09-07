import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sql: vi.fn() }))

vi.mock('../../src/db/client.js', () => ({ sql: mocks.sql }))

import { loadResourceCollectionContext } from '../../src/platform/resource-collection-context.js'

beforeEach(() => {
  vi.clearAllMocks()
})

test('loads the current organization context for a resource lifecycle', async () => {
  const lifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
  const context = { organizationVersion: 7, corporationId: 98_000_001 }
  mocks.sql.mockResolvedValue([context])

  await expect(
    loadResourceCollectionContext({ kind: 'character', characterId: 9001, lifecycleId }),
  ).resolves.toEqual(context)
  expect(mocks.sql.mock.calls[0]?.slice(1)).toEqual([lifecycleId])
})

test('rejects an obsolete resource lifecycle', async () => {
  mocks.sql.mockResolvedValue([])

  await expect(
    loadResourceCollectionContext({
      kind: 'deployment',
      deploymentId: 1,
      lifecycleId: 'ad599062-762a-46a4-8f89-b900b06c8311',
    }),
  ).rejects.toThrow('Resource collection context is obsolete')
})
