import { beforeEach, describe, expect, test, vi } from 'vitest'

describe('ESI shared cooldowns', () => {
  beforeEach(() => vi.resetModules())

  test('suppresses another operation after a global low-budget response', async () => {
    const redis = memoryRedis()
    const { acquireEsiRequestPermit, EsiQuotaError, recordEsiResponse } =
      await import('../src/esi-resilience/cooldowns.js')
    await recordEsiResponse({
      connection: redis as never,
      operation: 'status',
      status: 500,
      headers: new Headers({ 'x-esi-error-limit-remain': '0', 'x-esi-error-limit-reset': '20' }),
    })

    await expect(
      acquireEsiRequestPermit({
        connection: redis as never,
        operation: 'bulk-affiliation',
        concurrency: 2,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
  })

  test('bounds queued operation concurrency and releases its owner lease atomically', async () => {
    const redis = memoryRedis()
    const { acquireEsiRequestPermit, EsiQuotaError } =
      await import('../src/esi-resilience/cooldowns.js')
    const first = await acquireEsiRequestPermit({
      connection: redis as never,
      operation: 'status',
      concurrency: 1,
    })
    await expect(
      acquireEsiRequestPermit({
        connection: redis as never,
        operation: 'status',
        concurrency: 1,
        queueTimeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
    await first.release()
    await expect(
      acquireEsiRequestPermit({ connection: redis as never, operation: 'status', concurrency: 1 }),
    ).resolves.toMatchObject({ coordinationAvailable: true })
  })

  test('uses a stricter local operation limit when coordination is unavailable', async () => {
    const unavailable = {
      get: vi.fn().mockRejectedValue(new Error('unavailable')),
    }
    const { acquireEsiRequestPermit, EsiQuotaError } =
      await import('../src/esi-resilience/cooldowns.js')
    const first = await acquireEsiRequestPermit({
      connection: unavailable as never,
      operation: 'status',
      concurrency: 4,
    })
    const second = await acquireEsiRequestPermit({
      connection: unavailable as never,
      operation: 'status',
      concurrency: 4,
    })
    await expect(
      acquireEsiRequestPermit({
        connection: unavailable as never,
        operation: 'status',
        concurrency: 4,
        queueTimeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
    await Promise.all([first.release(), second.release()])
  })

  test('honors locally recorded cooldowns while coordination Redis is unavailable', async () => {
    const unavailable = { get: vi.fn().mockRejectedValue(new Error('unavailable')), eval: vi.fn() }
    const { acquireEsiRequestPermit, EsiQuotaError, recordEsiResponse } =
      await import('../src/esi-resilience/cooldowns.js')
    await recordEsiResponse({
      connection: unavailable as never,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })

    await expect(
      acquireEsiRequestPermit({
        connection: unavailable as never,
        operation: 'wallet-balance',
        principal: 'character-90000001',
        concurrency: 2,
      }),
    ).rejects.toEqual(new EsiQuotaError(12))
  })

  test('records principal-scoped 429 windows without treating token material as an identity', async () => {
    const redis = memoryRedis()
    const { recordEsiResponse } = await import('../src/esi-resilience/cooldowns.js')
    await recordEsiResponse({
      connection: redis as never,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '12', 'x-ratelimit-group': 'wallet' }),
    })

    expect([...redis.values.keys()]).toEqual([
      expect.stringMatching(
        /^eve-space:v1:esi-resilience:cooldown:group:char-wallet:character-90000001$/,
      ),
    ])
    await expect(
      recordEsiResponse({
        connection: redis as never,
        operation: 'wallet-balance',
        principal: 'access.token',
        status: 429,
        headers: new Headers(),
      }),
    ).rejects.toThrow('Invalid ESI principal identity')
  })

  test('inspects shared group cooldowns without acquiring a concurrency permit', async () => {
    const redis = memoryRedis()
    const { getEsiRequestCooldown, recordEsiResponse } =
      await import('../src/esi-resilience/cooldowns.js')
    await recordEsiResponse({
      connection: redis as never,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })

    await expect(
      getEsiRequestCooldown({
        connection: redis,
        operation: 'wallet-transactions',
        principal: 'character-90000001',
      }),
    ).resolves.toMatchObject({
      active: true,
      retryAfterSeconds: 12,
      coordinationAvailable: true,
    })
    await expect(
      getEsiRequestCooldown({
        connection: redis,
        operation: 'wallet-transactions',
        principal: 'character-90000002',
      }),
    ).resolves.toEqual({
      active: false,
      retryAfterSeconds: null,
      coordinationAvailable: true,
    })
    expect(redis.sortedSets.size).toBe(0)
  })

  test('reads a bounded ordered cooldown batch through one Redis mget', async () => {
    const redis = memoryRedis()
    const mget = vi.spyOn(redis, 'mget')
    const { getEsiRequestCooldowns, recordEsiResponse } =
      await import('../src/esi-resilience/cooldowns.js')
    await recordEsiResponse({
      connection: redis as never,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })

    await expect(
      getEsiRequestCooldowns({
        connection: redis,
        now: Date.now(),
        requests: [
          { operation: 'status' },
          { operation: 'wallet-transactions', principal: 'character-90000001' },
          { operation: 'status' },
        ],
      }),
    ).resolves.toEqual([
      { active: false, retryAfterSeconds: null, coordinationAvailable: true },
      { active: true, retryAfterSeconds: 12, coordinationAvailable: true },
      { active: false, retryAfterSeconds: null, coordinationAvailable: true },
    ])
    expect(mget).toHaveBeenCalledOnce()
    expect(mget.mock.calls[0]?.[0]).toBe('eve-space:v1:esi-resilience:cooldown:global')
  })

  test('falls back to process-local cooldowns when a batched Redis read fails', async () => {
    const unavailable = {
      eval: vi.fn().mockRejectedValue(new Error('unavailable')),
      mget: vi.fn().mockRejectedValue(new Error('unavailable')),
    }
    const { getEsiRequestCooldowns, recordEsiResponse } =
      await import('../src/esi-resilience/cooldowns.js')
    await recordEsiResponse({
      connection: unavailable as never,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })

    await expect(
      getEsiRequestCooldowns({
        connection: unavailable,
        requests: [{ operation: 'wallet-transactions', principal: 'character-90000001' }],
      }),
    ).resolves.toMatchObject([
      { active: true, retryAfterSeconds: 12, coordinationAvailable: false },
    ])
  })

  test('rejects cooldown batches larger than the planner selection bound', async () => {
    const redis = memoryRedis()
    const { getEsiRequestCooldowns } = await import('../src/esi-resilience/cooldowns.js')

    await expect(
      getEsiRequestCooldowns({
        connection: redis,
        requests: Array.from({ length: 101 }, () => ({ operation: 'status' as const })),
      }),
    ).rejects.toThrow('cooldown batch exceeds the resource planner page bound')
  })

  test('falls back to process-local cooldowns when read coordination is unavailable', async () => {
    const unavailable = { get: vi.fn().mockRejectedValue(new Error('unavailable')), eval: vi.fn() }
    const { getEsiRequestCooldown, recordEsiResponse } =
      await import('../src/esi-resilience/cooldowns.js')
    await recordEsiResponse({
      connection: unavailable as never,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })

    await expect(
      getEsiRequestCooldown({
        connection: unavailable,
        operation: 'wallet-transactions',
        principal: 'character-90000001',
      }),
    ).resolves.toMatchObject({
      active: true,
      retryAfterSeconds: 12,
      coordinationAvailable: false,
    })
  })
})

function memoryRedis() {
  const values = new Map<string, string>()
  const sortedSets = new Map<string, Map<string, number>>()
  return {
    values,
    sortedSets,
    async get(key: string) {
      return values.get(key) ?? null
    },
    async mget(...keys: string[]) {
      return keys.map((key) => values.get(key) ?? null)
    },
    async incr(key: string) {
      const next = Number(values.get(key) ?? 0) + 1
      values.set(key, String(next))
      return next
    },
    async pexpire() {
      return 1
    },
    async set(key: string, value: string) {
      values.set(key, value)
      return 'OK'
    },
    async eval(
      script: string,
      keyCount: number,
      key: string,
      ...arguments_: Array<string | number>
    ) {
      if (script.includes("redis.call('zremrangebyscore'")) {
        const now = Number(arguments_[0])
        const limit = Number(arguments_[1])
        const ttl = Number(arguments_[2])
        const members = sortedSets.get(key) ?? new Map<string, number>()
        for (const [member, expiresAt] of members) {
          if (expiresAt <= now) members.delete(member)
        }
        if (members.size >= limit) return 0
        members.set(String(arguments_[3]), now + ttl)
        sortedSets.set(key, members)
        return 1
      }
      if (script.includes("redis.call('zscore'")) {
        const [now, owner, ttl] = arguments_
        const members = sortedSets.get(key)
        const expiresAt = members?.get(String(owner))
        if (!expiresAt || expiresAt <= Number(now)) return 0
        members?.set(String(owner), Number(now) + Number(ttl))
        return 1
      }
      if (script.includes("redis.call('zrem'")) {
        sortedSets.get(key)?.delete(String(arguments_[0]))
        return 1
      }
      if (script.includes("redis.call('decr'")) {
        const current = Number(values.get(key) ?? 0)
        if (current <= 1) values.delete(key)
        else values.set(key, String(current - 1))
        return 1
      }
      if (script.includes('candidate <= current')) {
        const candidate = String(arguments_[0])
        if (Number(candidate) > Number(values.get(key) ?? 0)) values.set(key, candidate)
        return 1
      }
      return keyCount
    },
  }
}
