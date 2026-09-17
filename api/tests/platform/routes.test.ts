import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadRuntimeState: vi.fn(),
}))

vi.mock('../../src/platform/module-settings.js', () => ({
  loadModuleRuntimeState: mocks.loadRuntimeState,
}))

import { moduleRuntimeRoutes } from '../../src/platform/routes.js'

const runtimeState = {
  enabledModuleIds: ['alpha'],
  enabledSections: [
    {
      moduleId: 'alpha',
      sectionId: 'skills',
      kind: 'sensitive-evidence',
      disclosureVersion: 2,
      activationVersion: 1,
    },
  ],
  shellNavigationOrder: {
    dashboard: [{ ownerId: 'core', navigationId: 'core-overview' }],
    character: [{ ownerId: 'alpha', navigationId: 'alpha-character' }],
  },
}

beforeEach(() => {
  mocks.loadRuntimeState.mockResolvedValue(runtimeState)
})

describe('module runtime route', () => {
  test('exposes resolved enablement to every page audience', async () => {
    const response = await moduleRuntimeRoutes.request('/')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(runtimeState)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30')
  })
})
