import { describe, expect, test, vi } from 'vitest'
import {
  acquireLocalEsiRequestPermit,
  getLocalEsiCooldownUntil,
  recordLocalEsiCooldowns,
} from '../../src/esi-gateway/internal/local-quota.js'
import type { RuntimeLocalQuotaStatePort } from '../../src/esi-gateway/internal/runtime-ports.js'

describe('process-local ESI quota fallback', () => {
  test('records the strongest global, operation, and declared-group cooldowns', () => {
    const state = localQuotaState()
    recordLocalEsiCooldowns({
      globalRetryAt: 2000,
      now: 1000,
      operation: 'wallet-balance',
      operationRetryAt: 3000,
      principal: 'character-90000001',
      state,
    })
    recordLocalEsiCooldowns({
      globalRetryAt: 1500,
      now: 1000,
      operation: 'wallet-balance',
      operationRetryAt: 2500,
      principal: 'character-90000001',
      state,
    })

    expect(getLocalEsiCooldownUntil('wallet-balance', 'character-90000001', 1000, state)).toBe(3000)
    expect(getLocalEsiCooldownUntil('wallet-transactions', 'character-90000001', 1000, state)).toBe(
      3000,
    )
    expect(getLocalEsiCooldownUntil('status', 'public', 1000, state)).toBe(2000)
    expect(getLocalEsiCooldownUntil('wallet-balance', 'character-90000001', 3000, state)).toBe(0)
    expect(state.operationCooldowns.size).toBe(0)
    expect(state.groupCooldowns.size).toBe(0)
  })

  test('bounds retained operation and group cooldown identities', () => {
    const state = localQuotaState()
    for (let index = 0; index <= 1000; index += 1) {
      recordLocalEsiCooldowns({
        now: 1000,
        operation: 'wallet-balance',
        operationRetryAt: 2000,
        principal: `character-${index}`,
        state,
      })
    }

    expect(state.operationCooldowns.size).toBe(1000)
    expect(state.groupCooldowns.size).toBe(1000)
    expect(state.operationCooldowns.has('wallet-balance:character-0')).toBe(false)
    expect(state.groupCooldowns.has('char-wallet:character-0')).toBe(false)
  })

  test('limits concurrency, polls to the deadline, and releases permits', async () => {
    const state = localQuotaState()
    let now = 1000
    const wait = vi.fn(async (milliseconds: number) => {
      now += milliseconds
    })
    const options = {
      deadline: 1051,
      operation: 'status' as const,
      principal: 'public',
      sharedConcurrency: 4,
      state,
      timing: { now: () => now, wait },
    }

    const first = await acquireLocalEsiRequestPermit(options)
    const second = await acquireLocalEsiRequestPermit(options)
    await expect(acquireLocalEsiRequestPermit(options)).resolves.toStrictEqual({
      kind: 'timeout',
      retryAfterSeconds: 1,
    })
    expect(wait.mock.calls).toStrictEqual([
      [50, undefined],
      [1, undefined],
    ])
    expect(first.kind).toBe('acquired')
    expect(second.kind).toBe('acquired')
    if (first.kind !== 'acquired' || second.kind !== 'acquired') {
      return
    }

    await expect(first.permit.renew()).resolves.toBe(true)
    await first.permit.release()
    expect(state.inFlight.get('status')).toBe(1)
    await second.permit.release()
    expect(state.inFlight.has('status')).toBe(false)
  })

  test('reports active cooldowns and rejects an already-aborted request', async () => {
    const state = localQuotaState()
    state.operationCooldowns.set('status:public', 2001)

    await expect(
      acquireLocalEsiRequestPermit({
        deadline: 3000,
        operation: 'status',
        principal: 'public',
        sharedConcurrency: 0,
        state,
        timing: { now: () => 1000, wait: vi.fn() },
      }),
    ).resolves.toStrictEqual({ kind: 'cooldown', retryAfterSeconds: 2 })

    const controller = new AbortController()
    controller.abort()
    await expect(
      acquireLocalEsiRequestPermit({
        deadline: 3000,
        operation: 'status',
        principal: 'public',
        sharedConcurrency: 1,
        signal: controller.signal,
        state,
      }),
    ).rejects.toBe(controller.signal.reason)
  })
})

function localQuotaState(): RuntimeLocalQuotaStatePort {
  return {
    globalCooldownUntil: 0,
    groupCooldowns: new Map(),
    inFlight: new Map(),
    operationCooldowns: new Map(),
  }
}
