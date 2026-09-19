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
      operation: 'wallet-balance',
      principal: 'character-90000001',
      globalRetryAt: 2_000,
      operationRetryAt: 3_000,
      state,
      now: 1_000,
    })
    recordLocalEsiCooldowns({
      operation: 'wallet-balance',
      principal: 'character-90000001',
      globalRetryAt: 1_500,
      operationRetryAt: 2_500,
      state,
      now: 1_000,
    })

    expect(getLocalEsiCooldownUntil('wallet-balance', 'character-90000001', 1_000, state)).toBe(
      3_000,
    )
    expect(
      getLocalEsiCooldownUntil('wallet-transactions', 'character-90000001', 1_000, state),
    ).toBe(3_000)
    expect(getLocalEsiCooldownUntil('status', 'public', 1_000, state)).toBe(2_000)
    expect(getLocalEsiCooldownUntil('wallet-balance', 'character-90000001', 3_000, state)).toBe(0)
    expect(state.operationCooldowns.size).toBe(0)
    expect(state.groupCooldowns.size).toBe(0)
  })

  test('bounds retained operation and group cooldown identities', () => {
    const state = localQuotaState()
    for (let index = 0; index <= 1_000; index += 1) {
      recordLocalEsiCooldowns({
        operation: 'wallet-balance',
        principal: `character-${index}`,
        operationRetryAt: 2_000,
        state,
        now: 1_000,
      })
    }

    expect(state.operationCooldowns.size).toBe(1_000)
    expect(state.groupCooldowns.size).toBe(1_000)
    expect(state.operationCooldowns.has('wallet-balance:character-0')).toBe(false)
    expect(state.groupCooldowns.has('char-wallet:character-0')).toBe(false)
  })

  test('limits concurrency, polls to the deadline, and releases permits', async () => {
    const state = localQuotaState()
    let now = 1_000
    const wait = vi.fn(async (milliseconds: number) => {
      now += milliseconds
    })
    const options = {
      operation: 'status' as const,
      principal: 'public',
      sharedConcurrency: 4,
      deadline: 1_051,
      state,
      timing: { now: () => now, wait },
    }

    const first = await acquireLocalEsiRequestPermit(options)
    const second = await acquireLocalEsiRequestPermit(options)
    await expect(acquireLocalEsiRequestPermit(options)).resolves.toEqual({
      kind: 'timeout',
      retryAfterSeconds: 1,
    })
    expect(wait.mock.calls).toEqual([
      [50, undefined],
      [1, undefined],
    ])
    expect(first.kind).toBe('acquired')
    expect(second.kind).toBe('acquired')
    if (first.kind !== 'acquired' || second.kind !== 'acquired') return

    await expect(first.permit.renew()).resolves.toBe(true)
    await first.permit.release()
    expect(state.inFlight.get('status')).toBe(1)
    await second.permit.release()
    expect(state.inFlight.has('status')).toBe(false)
  })

  test('reports active cooldowns and rejects an already-aborted request', async () => {
    const state = localQuotaState()
    state.operationCooldowns.set('status:public', 2_001)

    await expect(
      acquireLocalEsiRequestPermit({
        operation: 'status',
        principal: 'public',
        sharedConcurrency: 0,
        deadline: 3_000,
        state,
        timing: { now: () => 1_000, wait: vi.fn() },
      }),
    ).resolves.toEqual({ kind: 'cooldown', retryAfterSeconds: 2 })

    const controller = new AbortController()
    controller.abort()
    await expect(
      acquireLocalEsiRequestPermit({
        operation: 'status',
        principal: 'public',
        sharedConcurrency: 1,
        deadline: 3_000,
        signal: controller.signal,
        state,
      }),
    ).rejects.toBe(controller.signal.reason)
  })
})

function localQuotaState(): RuntimeLocalQuotaStatePort {
  return {
    operationCooldowns: new Map(),
    groupCooldowns: new Map(),
    inFlight: new Map(),
    globalCooldownUntil: 0,
  }
}
