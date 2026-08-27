import { describe, expect, test, vi } from 'vitest'
import {
  assertWorkerDependencies,
  assertWorkerReadiness,
  assertWorkerStartupDependencies,
  checkWorkerDependencies,
  checkWorkerReadiness,
  checkWorkerStartupDependencies,
  expectedWorkerMigration,
  WorkerSchemaNotReadyError,
} from '../src/worker-readiness.js'

const expectedWorkerIdentity = `core/${expectedWorkerMigration}`

function appliedMigrationConnection() {
  return vi
    .fn()
    .mockResolvedValueOnce([{ exists: true, qualified: true }])
    .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
}

describe('worker readiness', () => {
  test('names the expected migration when the migrations table is missing', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false, qualified: false }])

    await expect(checkWorkerReadiness(connection as never)).resolves.toEqual({
      healthy: false,
      reason: `Missing migration ${expectedWorkerIdentity}`,
      missing: { module: 'core', name: expectedWorkerMigration },
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
      .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
    const queueProbe = vi.fn().mockResolvedValue({
      status: 'degraded',
      workerHeartbeatAt: new Date().toISOString(),
      oldestWaitingAgeSeconds: 301,
    })

    await expect(checkWorkerDependencies(connection as never, queueProbe)).resolves.toEqual({
      healthy: true,
    })
  })

  test('reports and logs database failures', async () => {
    const error = new Error('permission denied')
    const connection = vi.fn().mockRejectedValue(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(checkWorkerReadiness(connection as never)).resolves.toEqual({
      healthy: false,
      reason: 'Database unavailable',
    })
    expect(consoleError).toHaveBeenCalledWith('Worker database readiness check failed', error)
  })

  test('accepts an applied migration and operational queue', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
    const queueProbe = vi.fn().mockResolvedValue({
      status: 'operational',
      workerHeartbeatAt: new Date().toISOString(),
    })

    await expect(assertWorkerReadiness(connection as never)).resolves.toBeUndefined()

    const secondConnection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
    await expect(
      assertWorkerDependencies(secondConnection as never, queueProbe),
    ).resolves.toBeUndefined()
  })

  test('distinguishes an unavailable queue from degraded worker health', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
    const queueProbe = vi.fn().mockResolvedValue({ status: 'unavailable' })

    await expect(checkWorkerDependencies(connection as never, queueProbe)).resolves.toEqual({
      healthy: false,
      reason: 'Queue Redis unavailable',
    })
  })

  test('rejects dependency readiness failures', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false, qualified: false }])

    await expect(assertWorkerDependencies(connection as never, vi.fn())).rejects.toThrow(
      `Worker dependency unavailable: Missing migration ${expectedWorkerIdentity}`,
    )
  })

  test('admits a cold start whose queue reports no worker heartbeat yet', async () => {
    const queueProbe = vi.fn().mockResolvedValue({ status: 'degraded', workerHeartbeatAt: null })

    await expect(
      checkWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toEqual({ healthy: true })
    await expect(
      assertWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toBeUndefined()

    // The same state must still read unhealthy for an already-started worker.
    await expect(
      checkWorkerDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toEqual({ healthy: false, reason: 'Worker heartbeat stale' })
  })

  test('refuses to start when the queue Redis is unreachable', async () => {
    const queueProbe = vi.fn().mockResolvedValue({ status: 'unavailable' })

    await expect(
      checkWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toEqual({ healthy: false, reason: 'Queue Redis unavailable' })
    await expect(
      assertWorkerStartupDependencies(appliedMigrationConnection() as never, queueProbe),
    ).rejects.toThrow('Worker dependency unavailable: Queue Redis unavailable')
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
    const queueProbe = vi.fn().mockResolvedValue({
      status: 'degraded',
      workerHeartbeatAt: new Date(0).toISOString(),
    })

    await expect(
      checkWorkerDependencies(appliedMigrationConnection() as never, queueProbe),
    ).resolves.toEqual({ healthy: false, reason: 'Worker heartbeat stale' })
  })

  test('names a missing installed-module migration without running it', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
    const requirements = [
      { module: 'core', name: expectedWorkerMigration },
      { module: 'alpha', name: 'alpha-001-initial.sql' },
    ]

    await expect(checkWorkerReadiness(connection as never, requirements)).resolves.toEqual({
      healthy: false,
      reason: 'Missing migration alpha/alpha-001-initial.sql',
      missing: { module: 'alpha', name: 'alpha-001-initial.sql' },
    })
    expect(connection).toHaveBeenCalledTimes(2)
  })

  test('reports a qualified migration requirement for a legacy ledger', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: true, qualified: false }])

    await expect(checkWorkerReadiness(connection as never)).resolves.toEqual({
      healthy: false,
      reason: `Missing migration ${expectedWorkerIdentity}`,
      missing: { module: 'core', name: expectedWorkerMigration },
    })
    expect(connection).toHaveBeenCalledTimes(1)
  })

  test('requires provisioning for installed modules without migrations', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
      .mockResolvedValueOnce([])

    await expect(
      checkWorkerReadiness(
        connection as never,
        [{ module: 'core', name: expectedWorkerMigration }],
        ['empty-module'],
      ),
    ).resolves.toEqual({
      healthy: false,
      reason: 'Missing module provisioning empty-module',
      missingProvisioning: 'empty-module',
    })
    expect(connection).toHaveBeenCalledTimes(3)
  })

  test('accepts provisioned installed modules without migrations', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true, qualified: true }])
      .mockResolvedValueOnce([{ module: 'core', name: expectedWorkerMigration }])
      .mockResolvedValueOnce([{ module_id: 'empty-module' }])

    await expect(
      checkWorkerReadiness(
        connection as never,
        [{ module: 'core', name: expectedWorkerMigration }],
        ['empty-module'],
      ),
    ).resolves.toEqual({ healthy: true })
  })
})
