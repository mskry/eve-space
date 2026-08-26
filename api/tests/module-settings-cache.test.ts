import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  definitions: [{ moduleId: 'alpha', defaultEnabled: true }] as const,
  defaults: [
    { ownerId: 'core', navigationId: 'core-overview', placement: 'dashboard', order: 10 },
    { ownerId: 'alpha', navigationId: 'alpha-audit', placement: 'dashboard', order: 20 },
  ] as const,
  moduleRows: [] as Array<{ module_id: string; enabled: boolean; updated_at: Date }>,
  navigationRows: [] as Array<{ owner_id: string; navigation_id: string; position: number }>,
  pendingNavigationRows: [] as Array<{
    owner_id: string
    navigation_id: string
    position: number
  }>,
  blockedModuleRead: undefined as Promise<void> | undefined,
  failNextModuleRead: false,
  moduleReads: 0,
  navigationReads: 0,
  sql: Object.assign(vi.fn(), { begin: vi.fn() }),
  transaction: vi.fn(),
}))

vi.mock('../src/db/client.js', () => ({ sql: mocks.sql }))
vi.mock('../src/env.js', () => ({ env: { MODULE_RUNTIME_CACHE_TTL_MS: 5_000 } }))
vi.mock('../src/generated/platform/installed-module-runtime.js', () => ({
  installedModuleDefinitions: mocks.definitions,
  platformNavigationDefaults: mocks.defaults,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
  mocks.moduleRows = [
    { module_id: 'alpha', enabled: true, updated_at: new Date('2026-08-26T11:00:00.000Z') },
  ]
  mocks.navigationRows = []
  mocks.pendingNavigationRows = []
  mocks.blockedModuleRead = undefined
  mocks.failNextModuleRead = false
  mocks.moduleReads = 0
  mocks.navigationReads = 0

  mocks.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ')
    if (query.includes('select module_id, enabled')) {
      mocks.moduleReads += 1
      if (mocks.failNextModuleRead) {
        mocks.failNextModuleRead = false
        return Promise.reject(new Error('Database unavailable'))
      }
      const rows = mocks.moduleRows.map((row) => ({ ...row }))
      const blocked = mocks.blockedModuleRead
      mocks.blockedModuleRead = undefined
      return blocked ? blocked.then(() => rows) : Promise.resolve(rows)
    }
    if (query.includes('select owner_id, navigation_id, position')) {
      mocks.navigationReads += 1
      return Promise.resolve(mocks.navigationRows.map((row) => ({ ...row })))
    }
    if (query.includes('update deployment_modules')) {
      const [enabled, moduleId] = values as [boolean, string]
      const row = mocks.moduleRows.find((candidate) => candidate.module_id === moduleId)
      if (!row) return Promise.resolve([])
      row.enabled = enabled
      row.updated_at = new Date()
      return Promise.resolve([{ ...row }])
    }
    throw new Error(`Unexpected SQL: ${query}`)
  })
  mocks.sql.begin.mockImplementation(async (callback: (transaction: unknown) => unknown) =>
    callback(mocks.transaction),
  )
  mocks.transaction.mockImplementation((value: unknown) => {
    if (Array.isArray(value) && !('raw' in value)) {
      mocks.pendingNavigationRows = value.map((row) => ({ ...row }))
      return 'navigation-values'
    }
    mocks.navigationRows = mocks.pendingNavigationRows.map((row) => ({ ...row }))
    return Promise.resolve([])
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('module runtime state cache', () => {
  test('collapses concurrent reads and expires at the bounded lifetime', async () => {
    const { loadModuleRuntimeState } = await import('../src/platform/module-settings.js')

    const [first, second] = await Promise.all([loadModuleRuntimeState(), loadModuleRuntimeState()])
    expect(second).toBe(first)
    await loadModuleRuntimeState()
    expect(mocks.moduleReads).toBe(1)
    expect(mocks.navigationReads).toBe(1)

    await vi.advanceTimersByTimeAsync(5_000)
    await loadModuleRuntimeState()
    expect(mocks.moduleReads).toBe(2)
    expect(mocks.navigationReads).toBe(2)
  })

  test('does not cache a failed database read', async () => {
    mocks.failNextModuleRead = true
    const { loadModuleRuntimeState } = await import('../src/platform/module-settings.js')

    await expect(loadModuleRuntimeState()).rejects.toThrow('Database unavailable')
    await expect(loadModuleRuntimeState()).resolves.toMatchObject({
      enabledModuleIds: ['alpha'],
    })
    expect(mocks.moduleReads).toBe(2)
  })

  test('invalidates enablement and resolved navigation after a module mutation', async () => {
    const { loadModuleRuntimeState, setInstalledModuleEnabled } =
      await import('../src/platform/module-settings.js')

    await expect(loadModuleRuntimeState()).resolves.toMatchObject({
      enabledModuleIds: ['alpha'],
      shellNavigationOrder: {
        dashboard: [
          { ownerId: 'core', navigationId: 'core-overview' },
          { ownerId: 'alpha', navigationId: 'alpha-audit' },
        ],
      },
    })
    await setInstalledModuleEnabled('alpha', false)
    await expect(loadModuleRuntimeState()).resolves.toMatchObject({
      enabledModuleIds: [],
      shellNavigationOrder: {
        dashboard: [{ ownerId: 'core', navigationId: 'core-overview' }],
      },
    })
    expect(mocks.moduleReads).toBe(2)
    expect(mocks.navigationReads).toBe(2)
  })

  test('invalidates resolved navigation after a shell-order mutation', async () => {
    const { loadModuleRuntimeState, saveInstalledShellNavigationOrder } =
      await import('../src/platform/module-settings.js')
    await loadModuleRuntimeState()

    const dashboard = [
      { ownerId: 'alpha', navigationId: 'alpha-audit' },
      { ownerId: 'core', navigationId: 'core-overview' },
    ]
    await saveInstalledShellNavigationOrder({ dashboard, character: [] })

    await expect(loadModuleRuntimeState()).resolves.toMatchObject({
      shellNavigationOrder: { dashboard },
    })
    expect(mocks.moduleReads).toBe(2)
  })

  test('retries an in-flight read invalidated by a concurrent mutation', async () => {
    let releaseRead!: () => void
    mocks.blockedModuleRead = new Promise((resolve) => {
      releaseRead = resolve
    })
    const { loadModuleRuntimeState, setInstalledModuleEnabled } =
      await import('../src/platform/module-settings.js')

    const state = loadModuleRuntimeState()
    await vi.waitFor(() => expect(mocks.moduleReads).toBe(1))
    await setInstalledModuleEnabled('alpha', false)
    releaseRead()

    await expect(state).resolves.toMatchObject({ enabledModuleIds: [] })
    expect(mocks.moduleReads).toBe(2)
    expect(mocks.navigationReads).toBe(2)
  })

  test('keeps replica caches isolated until the uninformed replica expires', async () => {
    const replicaA = await import('../src/platform/module-settings.js')
    await expect(replicaA.loadModuleRuntimeState()).resolves.toMatchObject({
      enabledModuleIds: ['alpha'],
    })

    vi.resetModules()
    const replicaB = await import('../src/platform/module-settings.js')
    await replicaB.setInstalledModuleEnabled('alpha', false)
    await expect(replicaB.loadModuleRuntimeState()).resolves.toMatchObject({ enabledModuleIds: [] })
    await expect(replicaA.loadModuleRuntimeState()).resolves.toMatchObject({
      enabledModuleIds: ['alpha'],
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await expect(replicaA.loadModuleRuntimeState()).resolves.toMatchObject({ enabledModuleIds: [] })
  })

  test('bypasses the singleton for explicitly injected database reads', async () => {
    const { loadModuleRuntimeState } = await import('../src/platform/module-settings.js')

    await loadModuleRuntimeState(mocks.sql as never, mocks.definitions, mocks.defaults)
    await loadModuleRuntimeState(mocks.sql as never, mocks.definitions, mocks.defaults)

    expect(mocks.moduleReads).toBe(2)
    expect(mocks.navigationReads).toBe(2)
  })
})
