import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ModulePersistenceAttestationError } from '../../src/db/module-persistence-attestation.js'
import {
  assertWorkerDependencies,
  assertWorkerReadiness,
  assertWorkerStartupDependencies,
  checkWorkerDependencies,
  checkWorkerReadiness,
  checkWorkerStartupDependencies,
  expectedWorkerMigration,
  WorkerSchemaNotReadyError,
} from '../../src/worker/readiness.js'

import {
  installedModuleIds,
  installedModuleMigrations,
} from '../../src/generated/platform/installed-module-migrations.js'

const mocks = vi.hoisted(() => ({
  assertPersistenceContract: vi.fn(),
}))

vi.mock('../../src/db/module-persistence-attestation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  assertInstalledModulePersistenceContract: mocks.assertPersistenceContract,
}))

const appliedMigrations = [
  { module: 'core', name: expectedWorkerMigration },
  ...installedModuleMigrations.map(({ moduleId, name }) => ({ module: moduleId, name })),
]
const provisionedModules = installedModuleIds.map((module_id) => ({ module_id }))

const expectedWorkerIdentity = `core/${expectedWorkerMigration}`

beforeEach(() => {
  mocks.assertPersistenceContract.mockResolvedValue(undefined)
})

function appliedMigrationConnection() {
  return vi
    .fn()
    .mockResolvedValueOnce([{ exists: true, qualified: true }])
    .mockResolvedValueOnce(appliedMigrations)
    .mockResolvedValueOnce(provisionedModules)
}

describe('worker readiness', () => {
  test('names the expected migration when the migrations table is missing', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false, qualified: false }])

    await expect(checkWorkerReadiness(connection as never)).resolves.toStrictEqual({
      healthy: false,
      missing: { module: 'core', name: expectedWorkerMigration },
      reason: `Missing migration ${expectedWorkerIdentity}`,
    })
  })

  test('rejects startup when the expected migration is absent', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce([])

    await expect(assertWorkerReadiness(connection as never)).rejects.toBeInstanceOf(
      WorkerSchemaNotReadyError,
    )
  })

  test('keeps worker health green while fresh-heartbeat backlog telemetry is degraded', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce(appliedMigrations)
      .mockResolvedValueOnce(provisionedModules)
    const queueProbe = vi.fn().mockResolvedValue({
      heartbeatAt: new Date().toISOString(),
      status: 'operational',
    })

    await expect(checkWorkerDependencies(queueProbe, connection as never)).resolves.toStrictEqual({
      healthy: true,
    })
  })

  test('reports database failures without emitting a duplicate process diagnostic', async () => {
    const connection = vi.fn().mockRejectedValue(new Error('password=private-value'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(checkWorkerReadiness(connection as never)).resolves.toStrictEqual({
      healthy: false,
      reason: 'Database unavailable',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('reports bounded persistence attestation failures', async () => {
    const connection = appliedMigrationConnection()
    mocks.assertPersistenceContract.mockRejectedValue(
      new ModulePersistenceAttestationError('organization-activity', 'catalog', 'authority'),
    )

    await expect(checkWorkerReadiness(connection as never)).resolves.toStrictEqual({
      healthy: false,
      reason: 'Module persistence attestation organization-activity/catalog rejected: authority',
    })
  })

  test('accepts an applied migration and operational queue', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce(appliedMigrations)
      .mockResolvedValueOnce(provisionedModules)
    const queueProbe = vi.fn().mockResolvedValue({
      heartbeatAt: new Date().toISOString(),
      status: 'operational',
    })

    await expect(assertWorkerReadiness(connection as never)).resolves.toBeUndefined()

    const secondConnection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce(appliedMigrations)
      .mockResolvedValueOnce(provisionedModules)
    await expect(
      assertWorkerDependencies(queueProbe, secondConnection as never),
    ).resolves.toBeUndefined()
  })

  test('distinguishes an unavailable queue from degraded worker health', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce(appliedMigrations)
      .mockResolvedValueOnce(provisionedModules)
    const queueProbe = vi.fn().mockResolvedValue({ heartbeatAt: null, status: 'unavailable' })

    await expect(checkWorkerDependencies(queueProbe, connection as never)).resolves.toStrictEqual({
      healthy: false,
      reason: 'Queue Redis unavailable',
    })
  })

  test('contains scoped liveness probe rejections for a running worker', async () => {
    const queueProbe = vi
      .fn()
      .mockRejectedValue(new Error('redis://user:password@private-host unavailable'))

    const result = await checkWorkerDependencies(queueProbe, appliedMigrationConnection() as never)

    expect(result).toStrictEqual({ healthy: false, reason: 'Queue Redis unavailable' })
    expect(JSON.stringify(result)).not.toContain('private-host')
  })

  test('rejects dependency readiness failures', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false, qualified: false }])

    await expect(assertWorkerDependencies(vi.fn(), connection as never)).rejects.toThrow(
      `Worker dependency unavailable: Missing migration ${expectedWorkerIdentity}`,
    )
  })

  test('admits a cold start whose queue reports no worker heartbeat yet', async () => {
    const queueProbe = vi.fn().mockResolvedValue({ status: 'degraded', workerHeartbeatAt: null })

    await expect(
      checkWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toStrictEqual({ healthy: true })
    await expect(
      assertWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toBeUndefined()

    // The same state must still read unhealthy for an already-started worker.
    await expect(
      checkWorkerDependencies(
        vi.fn().mockResolvedValue({ heartbeatAt: null, status: 'stale' }),
        appliedMigrationConnection() as never,
      ),
    ).resolves.toStrictEqual({ healthy: false, reason: 'Worker heartbeat stale' })
  })

  test('refuses to start when the queue Redis is unreachable', async () => {
    const queueProbe = vi.fn().mockResolvedValue({ status: 'unavailable' })

    await expect(
      checkWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toStrictEqual({ healthy: false, reason: 'Queue Redis unavailable' })
    await expect(
      assertWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).rejects.toThrow('Worker dependency unavailable: Queue Redis unavailable')
  })

  test('contains scoped liveness probe rejections during startup', async () => {
    const queueProbe = vi
      .fn()
      .mockRejectedValue(new Error('redis://user:password@private-host unavailable'))

    await expect(
      checkWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toStrictEqual({ healthy: false, reason: 'Queue Redis unavailable' })
  })

  test('refuses to start before the required migration is applied', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false, qualified: false }])
    const queueProbe = vi.fn()

    await expect(assertWorkerStartupDependencies(connection as never, queueProbe)).rejects.toThrow(
      `Worker dependency unavailable: Missing migration ${expectedWorkerIdentity}`,
    )
    expect(queueProbe).not.toHaveBeenCalled()
  })

  test('fails an already-running worker when its scoped heartbeat is stale', async () => {
    const queueProbe = vi.fn().mockResolvedValue({ heartbeatAt: null, status: 'stale' })

    await expect(
      checkWorkerDependencies(queueProbe, appliedMigrationConnection() as never),
    ).resolves.toStrictEqual({ healthy: false, reason: 'Worker heartbeat stale' })
  })

  test('names a missing installed-module migration without running it', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce(appliedMigrations)
      .mockResolvedValueOnce(provisionedModules)
    const requirements = [
      { module: 'core', name: expectedWorkerMigration },
      { module: 'alpha', name: 'alpha-001-initial.sql' },
    ]

    await expect(checkWorkerReadiness(connection as never, requirements)).resolves.toStrictEqual({
      healthy: false,
      missing: { module: 'alpha', name: 'alpha-001-initial.sql' },
      reason: 'Missing migration alpha/alpha-001-initial.sql',
    })
    expect(connection).toHaveBeenCalledTimes(2)
  })

  test('reports a qualified migration requirement for a legacy ledger', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: true, qualified: false }])

    await expect(checkWorkerReadiness(connection as never)).resolves.toStrictEqual({
      healthy: false,
      missing: { module: 'core', name: expectedWorkerMigration },
      reason: `Missing migration ${expectedWorkerIdentity}`,
    })
    expect(connection).toHaveBeenCalledTimes(1)
  })

  test('requires provisioning for installed modules without migrations', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce(appliedMigrations)
      .mockResolvedValueOnce([])

    await expect(
      checkWorkerReadiness(
        connection as never,
        [{ module: 'core', name: expectedWorkerMigration }],
        ['empty-module'],
      ),
    ).resolves.toStrictEqual({
      healthy: false,
      missingProvisioning: 'empty-module',
      reason: 'Missing module provisioning empty-module',
    })
    expect(connection).toHaveBeenCalledTimes(3)
  })

  test('accepts provisioned installed modules without migrations', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce(appliedMigrations)
      .mockResolvedValueOnce([{ module_id: 'empty-module' }])

    await expect(
      checkWorkerReadiness(
        connection as never,
        [{ module: 'core', name: expectedWorkerMigration }],
        ['empty-module'],
      ),
    ).resolves.toStrictEqual({ healthy: true })
  })
})
