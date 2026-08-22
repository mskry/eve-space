import { describe, expect, test, vi } from 'vitest'
import {
  assertWorkerReadiness,
  checkWorkerReadiness,
  WorkerSchemaNotReadyError,
} from '../src/worker-readiness.js'

describe('worker readiness', () => {
  test('names the expected migration when the migrations table is missing', async () => {
    const connection = vi.fn().mockResolvedValueOnce([{ exists: false }])

    await expect(checkWorkerReadiness(connection as never)).resolves.toEqual({
      healthy: false,
      reason: 'Missing migration 007_token_version.sql',
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
})
