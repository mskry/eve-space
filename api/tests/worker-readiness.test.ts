import { describe, expect, test, vi } from 'vitest'
import {
  assertWorkerDependencies,
  assertWorkerReadiness,
  assertWorkerStartupDependencies,
  checkWorkerDependencies,
  checkWorkerReadiness,
  checkWorkerStartupDependencies,
  WorkerSchemaNotReadyError,
} from '../src/worker-readiness.js'

function appliedMigrationConnection() {
  return vi
    .fn()
    .mockResolvedValueOnce([{ exists: true }])
    .mockResolvedValueOnce([{ applied: true }])
}

describe('worker readiness', () => {
  test('names the expected migration when the migrations table is missing', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false }])

    await expect(checkWorkerReadiness(connection as never)).resolves.toEqual({
      healthy: false,
      reason: 'Missing migration 008_deployment_installation_settings.sql',
    })
  })

  test('rejects startup when the expected migration is absent', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ applied: false }])

    await expect(assertWorkerReadiness(connection as never)).rejects.toBeInstanceOf(
      WorkerSchemaNotReadyError,
    )
  })

  test('fails health when the worker heartbeat or queue lag is degraded', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ applied: true }])
    const queueProbe = vi.fn().mockResolvedValue({ status: 'degraded' })

    await expect(checkWorkerDependencies(connection as never, queueProbe)).resolves.toEqual({
      healthy: false,
      reason: 'Worker or queue degraded',
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
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ applied: true }])
    const queueProbe = vi.fn().mockResolvedValue({ status: 'operational' })

    await expect(assertWorkerReadiness(connection as never)).resolves.toBeUndefined()

    const secondConnection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ applied: true }])
    await expect(
      assertWorkerDependencies(secondConnection as never, queueProbe),
    ).resolves.toBeUndefined()
  })

  test('distinguishes an unavailable queue from degraded worker health', async () => {
    const connection = vi
      .fn()
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ applied: true }])
    const queueProbe = vi.fn().mockResolvedValue({ status: 'unavailable' })

    await expect(checkWorkerDependencies(connection as never, queueProbe)).resolves.toEqual({
      healthy: false,
      reason: 'Queue Redis unavailable',
    })
  })

  test('rejects dependency readiness failures', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false }])

    await expect(assertWorkerDependencies(connection as never, vi.fn())).rejects.toThrow(
      'Worker dependency unavailable: Missing migration 008_deployment_installation_settings.sql',
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
    ).resolves.toEqual({ healthy: false, reason: 'Worker or queue degraded' })
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
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false }])
    const queueProbe = vi.fn()

    await expect(assertWorkerStartupDependencies(connection as never, queueProbe)).rejects.toThrow(
      'Worker dependency unavailable: Missing migration 008_deployment_installation_settings.sql',
    )
    expect(queueProbe).not.toHaveBeenCalled()
  })
})
