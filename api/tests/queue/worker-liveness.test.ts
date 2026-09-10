import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workerHeartbeatStaleAfterMs } from '../../src/queue/policy.js'
import {
  evaluateScopedWorkerLiveness,
  probeScopedWorkerLiveness,
} from '../../src/queue/worker-liveness.js'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  connection: {
    get: vi.fn(),
    ping: vi.fn(),
  },
  createProbe: vi.fn(),
}))

vi.mock('../../src/coordination-redis.js', () => ({
  closeCoordinationRedisConnection: mocks.close,
  createCoordinationRedisProbe: mocks.createProbe,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.close.mockResolvedValue(undefined)
  mocks.connection.get.mockResolvedValue(new Date().toISOString())
  mocks.connection.ping.mockResolvedValue('PONG')
  mocks.createProbe.mockReturnValue(mocks.connection)
})

describe('scoped worker liveness', () => {
  test('accepts a fresh replica heartbeat without queue backlog input', () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z')
    const heartbeatAt = new Date(now - workerHeartbeatStaleAfterMs + 1).toISOString()
    expect(evaluateScopedWorkerLiveness(heartbeatAt, now)).toEqual({
      status: 'operational',
      heartbeatAt,
    })
  })

  test('does not expose missing, malformed, or stale heartbeat values', () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z')
    expect(evaluateScopedWorkerLiveness(null, now)).toEqual({ status: 'stale', heartbeatAt: null })
    expect(evaluateScopedWorkerLiveness('redis://private-host', now)).toEqual({
      status: 'stale',
      heartbeatAt: null,
    })
    expect(
      evaluateScopedWorkerLiveness(
        new Date(now - workerHeartbeatStaleAfterMs - 1).toISOString(),
        now,
      ),
    ).toEqual({ status: 'stale', heartbeatAt: null })
    expect(evaluateScopedWorkerLiveness('2026-09-10', now)).toEqual({
      status: 'stale',
      heartbeatAt: null,
    })
    expect(
      evaluateScopedWorkerLiveness(
        new Date(now + workerHeartbeatStaleAfterMs + 1).toISOString(),
        now,
      ),
    ).toEqual({ status: 'stale', heartbeatAt: null })
  })

  test('probes only the selected replica and closes its connection', async () => {
    const heartbeatAt = new Date().toISOString()
    mocks.connection.get.mockResolvedValue(heartbeatAt)

    await expect(probeScopedWorkerLiveness('worker-a')).resolves.toEqual({
      status: 'operational',
      heartbeatAt,
    })
    expect(mocks.connection.get).toHaveBeenCalledWith('eve-space:v1:worker:heartbeat:worker-a')
    expect(mocks.close).toHaveBeenCalledWith(mocks.connection)
  })

  test.each(['create', 'ping', 'get', 'close'] as const)(
    'contains no dependency details when %s fails',
    async (stage) => {
      const failure = new Error('redis://user:password@private-host unavailable')
      const heartbeatAt = new Date().toISOString()
      mocks.connection.get.mockResolvedValue(heartbeatAt)
      if (stage === 'create')
        mocks.createProbe.mockImplementationOnce(() => {
          throw failure
        })
      if (stage === 'ping') mocks.connection.ping.mockRejectedValueOnce(failure)
      if (stage === 'get') mocks.connection.get.mockRejectedValueOnce(failure)
      if (stage === 'close') mocks.close.mockRejectedValueOnce(failure)

      const result = await probeScopedWorkerLiveness('worker-a')

      expect(JSON.stringify(result)).not.toContain('private-host')
      expect(result).toEqual(
        stage === 'close'
          ? { status: 'operational', heartbeatAt }
          : { status: 'unavailable', heartbeatAt: null },
      )
    },
  )
})
