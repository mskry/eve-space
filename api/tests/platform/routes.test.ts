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
      activationVersion: 1,
      disclosureVersion: 2,
      kind: 'sensitive-evidence',
      moduleId: 'alpha',
      sectionId: 'skills',
    },
  ],
  shellNavigationOrder: {
    character: [{ ownerId: 'alpha', navigationId: 'alpha-character' }],
    dashboard: [{ ownerId: 'core', navigationId: 'core-overview' }],
  },
}

beforeEach(() => {
  mocks.loadRuntimeState.mockResolvedValue(runtimeState)
})

describe('module runtime route', () => {
  test('exposes resolved enablement to every page audience', async () => {
    const response = await moduleRuntimeRoutes.request('/')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual(runtimeState)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30')
  })
})
