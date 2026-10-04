import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const queueTimeoutMs = 30_000
const maximumRequests = 100

describe('ESI shared cooldowns', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.useRealTimers())

  test('suppresses another operation after a global low-budget response', async () => {
    const redis = memoryRedis()
    const [{ recordEsiResponse }, { EsiQuotaError }, { acquireEsiRequestPermit }] =
      await Promise.all([
        import('../../src/esi-gateway/internal/cooldowns.js'),
        import('../../src/esi-gateway/failures.js'),
        import('../../src/esi-gateway/internal/permits.js'),
      ])
    await recordEsiResponse({
      connection: redis as never,
      metadata: { errorLimit: { remaining: 0, reset: 20 }, headers: {}, status: 500 },
      operation: 'status',
    })

    await expect(
      acquireEsiRequestPermit({
        concurrency: 2,
        connection: redis as never,
        operation: 'bulk-affiliation',
        queueTimeoutMs,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
  })

  test('does not pace from absent, malformed, or mismatched remaining headers', async () => {
    const redis = memoryRedis()
    const { recordEsiResponse } = await import('../../src/esi-gateway/internal/cooldowns.js')
    for (const routeRateLimit of [
      undefined,
      { group: 'char-wallet', remaining: Number.NaN },
      { group: 'different-wallet', remaining: 0 },
      { group: 'char-wallet', remaining: 21 },
    ]) {
      // SAFETY: The in-memory fixture implements the Redis commands exercised by response recording.
      await recordEsiResponse({
        connection: redis as never,
        metadata: { headers: {}, routeRateLimit, status: 200 },
        operation: 'wallet-balance',
        principal: 'character-90000001',
        concurrency: 4,
      })
    }
    expect([...redis.values.keys()]).not.toContainEqual(expect.stringContaining(':pacing:'))
  })

  test.each([
    [{ remaining: 100, reset: 18 }, 18],
    [undefined, 60],
    [{ reset: 0 }, 60],
    [{ reset: 100_000 }, 60],
  ] as const)(
    'applies global 420 cooldown with reset %j',
    async (errorLimit, retryAfterSeconds) => {
      vi.useFakeTimers()
      const now = Date.parse('2026-09-01T11:00:00.000Z')
      vi.setSystemTime(now)
      const redis = memoryRedis()
      const { recordEsiResponse, getEsiRequestCooldown, esiPacingKey } =
        await import('../../src/esi-gateway/internal/cooldowns.js')
      // SAFETY: The in-memory fixture implements the Redis commands exercised by response recording.
      await recordEsiResponse({
        connection: redis as never,
        metadata: {
          headers: {},
          errorLimit,
          routeRateLimit: { group: 'status', remaining: 3 },
          status: 420,
        },
        operation: 'status',
        now,
      })
      await expect(
        getEsiRequestCooldown({ connection: redis, operation: 'wallet-balance', now }),
      ).resolves.toMatchObject({
        active: true,
        retryAfterSeconds,
      })
      expect(redis.values.has(esiPacingKey('status', 'public'))).toBe(false)
    },
  )

  test('bounds queued operation concurrency and releases its owner lease atomically', async () => {
    const redis = memoryRedis()
    const [{ EsiQuotaError }, { acquireEsiRequestPermit }] = await Promise.all([
      import('../../src/esi-gateway/failures.js'),
      import('../../src/esi-gateway/internal/permits.js'),
    ])
    const first = await acquireEsiRequestPermit({
      concurrency: 1,
      connection: redis as never,
      operation: 'status',
      queueTimeoutMs,
    })
    await expect(
      acquireEsiRequestPermit({
        concurrency: 1,
        connection: redis as never,
        operation: 'status',
        queueTimeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
    await first.release()
    await expect(
      acquireEsiRequestPermit({
        concurrency: 1,
        connection: redis as never,
        operation: 'status',
        queueTimeoutMs,
      }),
    ).resolves.toMatchObject({ coordinationAvailable: true })
  })

  test('uses a stricter local operation limit when coordination is unavailable', async () => {
    const unavailable = {
      get: vi.fn().mockRejectedValue(new Error('unavailable')),
    }
    const [{ EsiQuotaError }, { acquireEsiRequestPermit }] = await Promise.all([
      import('../../src/esi-gateway/failures.js'),
      import('../../src/esi-gateway/internal/permits.js'),
    ])
    const first = await acquireEsiRequestPermit({
      concurrency: 4,
      connection: unavailable as never,
      operation: 'status',
      queueTimeoutMs,
    })
    const second = await acquireEsiRequestPermit({
      concurrency: 4,
      connection: unavailable as never,
      operation: 'status',
      queueTimeoutMs,
    })
    await expect(
      acquireEsiRequestPermit({
        concurrency: 4,
        connection: unavailable as never,
        operation: 'status',
        queueTimeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
    await Promise.all([first.release(), second.release()])
  })

  test('honors locally recorded cooldowns while coordination Redis is unavailable', async () => {
    const unavailable = { eval: vi.fn(), get: vi.fn().mockRejectedValue(new Error('unavailable')) }
    const [{ recordEsiResponse }, { acquireEsiRequestPermit }] = await Promise.all([
      import('../../src/esi-gateway/internal/cooldowns.js'),
      import('../../src/esi-gateway/internal/permits.js'),
    ])
    await recordEsiResponse({
      connection: unavailable as never,
      metadata: { headers: {}, retryAfterSeconds: 12, status: 429 },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    await expect(
      acquireEsiRequestPermit({
        concurrency: 2,
        connection: unavailable as never,
        operation: 'wallet-balance',
        principal: 'character-90000001',
        queueTimeoutMs,
      }),
    ).rejects.toMatchObject({ name: 'EsiQuotaError', retryAfterSeconds: 12 })
  })

  test.each([
    [13, 13],
    [0, null],
    [undefined, 60],
  ] as const)(
    'uses typed Retry-After value %s as %s seconds',
    async (retryAfterSeconds, expected) => {
      vi.useFakeTimers()
      const now = Date.parse('2026-09-01T11:00:00.000Z')
      vi.setSystemTime(now)
      const redis = memoryRedis()
      const { getEsiRequestCooldown, recordEsiResponse } =
        await import('../../src/esi-gateway/internal/cooldowns.js')
      await recordEsiResponse({
        connection: redis as never,
        metadata: {
          headers: {},
          status: 429,
          ...(!(retryAfterSeconds === undefined) && { retryAfterSeconds }),
        },
        operation: 'status',
      })

      await expect(
        getEsiRequestCooldown({ connection: redis, now, operation: 'status' }),
      ).resolves.toStrictEqual({
        active: expected !== null,
        coordinationAvailable: true,
        retryAfterSeconds: expected,
      })
    },
  )

  test('records principal-scoped 429 windows without treating token material as an identity', async () => {
    const redis = memoryRedis()
    const { recordEsiResponse } = await import('../../src/esi-gateway/internal/cooldowns.js')
    await recordEsiResponse({
      connection: redis as never,
      metadata: {
        headers: {},
        retryAfterSeconds: 12,
        routeRateLimit: { group: 'char-wallet', remaining: 3 },
        status: 429,
      },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    expect([...redis.values.keys()]).toStrictEqual([
      expect.stringMatching(
        /^eve-space:v1:esi-resilience:cooldown:group:char-wallet:character-90000001$/,
      ),
    ])
    await expect(
      recordEsiResponse({
        connection: redis as never,
        metadata: { headers: {}, status: 429 },
        operation: 'wallet-balance',
        principal: 'access.token',
      }),
    ).rejects.toThrow('Invalid ESI principal identity')
  })

  test('inspects shared group cooldowns without acquiring a concurrency permit', async () => {
    const redis = memoryRedis()
    const { getEsiRequestCooldown, recordEsiResponse } =
      await import('../../src/esi-gateway/internal/cooldowns.js')
    await recordEsiResponse({
      connection: redis as never,
      metadata: { headers: {}, retryAfterSeconds: 12, status: 429 },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    await expect(
      getEsiRequestCooldown({
        connection: redis,
        operation: 'wallet-transactions',
        principal: 'character-90000001',
      }),
    ).resolves.toMatchObject({
      active: true,
      coordinationAvailable: true,
      retryAfterSeconds: 12,
    })
    await expect(
      getEsiRequestCooldown({
        connection: redis,
        operation: 'wallet-transactions',
        principal: 'character-90000002',
      }),
    ).resolves.toStrictEqual({
      active: false,
      coordinationAvailable: true,
      retryAfterSeconds: null,
    })
    expect(redis.sortedSets.size).toBe(0)
  })

  test('reads a bounded ordered cooldown batch through one Redis mget', async () => {
    const redis = memoryRedis()
    const mget = vi.spyOn(redis, 'mget')
    const { getEsiRequestCooldowns, recordEsiResponse } =
      await import('../../src/esi-gateway/internal/cooldowns.js')
    await recordEsiResponse({
      connection: redis as never,
      metadata: { headers: {}, retryAfterSeconds: 12, status: 429 },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    await expect(
      getEsiRequestCooldowns({
        connection: redis,
        maximumRequests,
        now: Date.now(),
        requests: [
          { operation: 'status' },
          { operation: 'wallet-transactions', principal: 'character-90000001' },
          { operation: 'status' },
        ],
      }),
    ).resolves.toStrictEqual([
      { active: false, coordinationAvailable: true, retryAfterSeconds: null },
      { active: true, coordinationAvailable: true, retryAfterSeconds: 12 },
      { active: false, coordinationAvailable: true, retryAfterSeconds: null },
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
      await import('../../src/esi-gateway/internal/cooldowns.js')
    await recordEsiResponse({
      connection: unavailable as never,
      metadata: { headers: {}, retryAfterSeconds: 12, status: 429 },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    await expect(
      getEsiRequestCooldowns({
        connection: unavailable,
        maximumRequests,
        requests: [{ operation: 'wallet-transactions', principal: 'character-90000001' }],
      }),
    ).resolves.toMatchObject([
      { active: true, coordinationAvailable: false, retryAfterSeconds: 12 },
    ])
  })

  test('rejects cooldown batches larger than the planner selection bound', async () => {
    const redis = memoryRedis()
    const { getEsiRequestCooldowns } = await import('../../src/esi-gateway/internal/cooldowns.js')

    await expect(
      getEsiRequestCooldowns({
        connection: redis,
        maximumRequests,
        requests: Array.from({ length: 101 }, () => ({ operation: 'status' as const })),
      }),
    ).rejects.toThrow('cooldown batch exceeds the resource planner page bound')
  })

  test('falls back to process-local cooldowns when read coordination is unavailable', async () => {
    const unavailable = { eval: vi.fn(), get: vi.fn().mockRejectedValue(new Error('unavailable')) }
    const { getEsiRequestCooldown, recordEsiResponse } =
      await import('../../src/esi-gateway/internal/cooldowns.js')
    await recordEsiResponse({
      connection: unavailable as never,
      metadata: { headers: {}, retryAfterSeconds: 12, status: 429 },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    await expect(
      getEsiRequestCooldown({
        connection: unavailable,
        operation: 'wallet-transactions',
        principal: 'character-90000001',
      }),
    ).resolves.toMatchObject({
      active: true,
      coordinationAvailable: false,
      retryAfterSeconds: 12,
    })
  })
})

const evaluateAtomicPermit = (
  values: Map<string, string>,
  sortedSets: Map<string, Map<string, number>>,
  key: string,
  args: Array<string | number>,
) => {
  const [globalKey, scopedKey, pacingKey, , limit, ttl, owner] = args
  const now = Date.now()
  const retryAt = Math.max(
    Number(values.get(String(globalKey)) ?? 0),
    Number(values.get(String(scopedKey)) ?? 0),
  )
  if (retryAt > now) return [2, retryAt - now]
  const pacing = values.get(String(pacingKey))?.split(':').map(Number)
  if (pacing && pacing[0]! > now) return [3, pacing[0]! - now]
  const members = sortedSets.get(key) ?? new Map<string, number>()
  for (const [member, expiresAt] of members) {
    if (expiresAt <= now) members.delete(member)
  }
  if (members.size >= Number(limit)) return [0, 0]
  members.set(String(owner), now + Number(ttl))
  sortedSets.set(key, members)
  if (pacing) {
    values.set(String(pacingKey), `${now + pacing[2]!}:${pacing[1]}:${pacing[2]}`)
  }
  return [1, 0]
}

const recordMemoryPacing = (
  values: Map<string, string>,
  key: string,
  args: Array<string | number>,
) => {
  const [interval, window] = args.map(Number)
  const now = Date.now()
  const previous = Number(values.get(key)?.split(':')[0] ?? 0)
  values.set(key, `${Math.max(previous, now + interval!)}:${now + window!}:${interval}`)
  return Math.max(previous, now + interval!) - now
}

function memoryRedis() {
  const values = new Map<string, string>()
  const sortedSets = new Map<string, Map<string, number>>()
  return {
    async eval(
      script: string,
      keyCount: number,
      key: string,
      ...arguments_: Array<string | number>
    ) {
      if (script.includes('return {1, 0}')) {
        return evaluateAtomicPermit(values, sortedSets, key, arguments_)
      }
      if (script.includes("local time = redis.call('time')")) {
        return recordMemoryPacing(values, key, arguments_)
      }
      if (script.includes("redis.call('zscore'")) {
        const [now, owner, ttl] = arguments_
        const members = sortedSets.get(key)
        const expiresAt = members?.get(String(owner))
        if (!expiresAt || expiresAt <= Number(now)) {
          return 0
        }
        members?.set(String(owner), Number(now) + Number(ttl))
        return 1
      }
      if (script.includes("redis.call('zrem'")) {
        sortedSets.get(key)?.delete(String(arguments_[0]))
        return 1
      }
      if (script.includes('candidate <= current')) {
        const candidate = String(arguments_[0])
        if (Number(candidate) > Number(values.get(key) ?? 0)) {
          values.set(key, candidate)
        }
        return 1
      }
      return keyCount
    },
    async get(key: string) {
      return values.get(key) ?? null
    },
    async incr(key: string) {
      const next = Number(values.get(key) ?? 0) + 1
      values.set(key, String(next))
      return next
    },
    async mget(...keys: string[]) {
      return keys.map((key) => values.get(key) ?? null)
    },
    async pexpire() {
      return 1
    },
    async set(key: string, value: string) {
      values.set(key, value)
      return 'OK'
    },
    sortedSets,
    values,
  }
}
