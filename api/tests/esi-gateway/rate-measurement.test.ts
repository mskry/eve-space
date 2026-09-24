import { describe, expect, test } from 'vitest'
import {
  esiRateMeasurementWindowMs,
  readEsiRateMeasurement,
  recordEsiRateMeasurement,
} from '../../src/esi-gateway/internal/rate-measurement.js'

describe('ESI rate measurement', () => {
  test('records fixed-window aggregates without retaining an enumerable principal', async () => {
    const commands: unknown[][] = []
    const transaction = Object.fromEntries(
      ['hincrby', 'pexpireat', 'pfadd'].map((command) => [
        command,
        (...arguments_: unknown[]) => {
          commands.push([command, ...arguments_])
          return transaction
        },
      ]),
    ) as Record<string, (...arguments_: unknown[]) => unknown>
    transaction.exec = async () => []
    const connection = { multi: () => transaction }
    const now = Date.parse('2026-08-25T12:07:00.000Z')

    await recordEsiRateMeasurement(connection as never, {
      now,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 200,
    })

    expect(commands).toHaveLength(10)
    expect(commands.filter(([command]) => command === 'hincrby')).toStrictEqual(
      expect.arrayContaining([
        expect.arrayContaining(['hincrby', expect.any(String), 'requests', 1]),
        expect.arrayContaining(['hincrby', expect.any(String), 'weightedTokens', 2]),
      ]),
    )
    expect(commands.filter(([command]) => command === 'pexpireat')).toStrictEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          'pexpireat',
          expect.any(String),
          Math.floor(now / esiRateMeasurementWindowMs) * esiRateMeasurementWindowMs +
            esiRateMeasurementWindowMs +
            86_400_000,
        ]),
      ]),
    )
    expect(JSON.stringify(commands)).not.toContain('character-90000001')
    expect(commands.filter(([command]) => command === 'pfadd')).toStrictEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          'pfadd',
          expect.any(String),
          expect.stringMatching(/^[a-f\d]{64}$/),
        ]),
      ]),
    )
  })

  test('does not measure legacy-only operations', async () => {
    let startedTransaction = false
    await recordEsiRateMeasurement(
      {
        multi: () => {
          startedTransaction = true
          throw new Error('unexpected transaction')
        },
      } as never,
      { operation: 'public-character', principal: 'character-90000001', status: 200 },
    )

    expect(startedTransaction).toBe(false)
  })

  test('does not measure a character group without a principal', async () => {
    let startedTransaction = false
    await recordEsiRateMeasurement(
      {
        multi: () => {
          startedTransaction = true
          throw new Error('unexpected transaction')
        },
      } as never,
      { operation: 'wallet-balance', status: 200 },
    )

    expect(startedTransaction).toBe(false)
  })

  test.each([
    [200, 2],
    [304, 1],
    [404, 5],
    [429, 0],
    [503, 0],
  ])('weights status %i responses as %i tokens', async (status, expectedWeight) => {
    const commands: unknown[][] = []
    const transaction = Object.fromEntries(
      ['hincrby', 'pexpireat', 'pfadd'].map((command) => [
        command,
        (...arguments_: unknown[]) => {
          commands.push([command, ...arguments_])
          return transaction
        },
      ]),
    ) as Record<string, (...arguments_: unknown[]) => unknown>
    transaction.exec = async () => []

    await recordEsiRateMeasurement({ multi: () => transaction } as never, {
      operation: 'status',
      status,
    })

    expect(commands).toContainEqual([
      'hincrby',
      expect.stringContaining(':operation:status:'),
      'weightedTokens',
      expectedWeight,
    ])
  })

  test('measures public declared groups without creating character cardinality keys', async () => {
    const commands: unknown[][] = []
    const transaction = Object.fromEntries(
      ['hincrby', 'pexpireat', 'pfadd'].map((command) => [
        command,
        (...arguments_: unknown[]) => {
          commands.push([command, ...arguments_])
          return transaction
        },
      ]),
    ) as Record<string, (...arguments_: unknown[]) => unknown>
    transaction.exec = async () => []

    await recordEsiRateMeasurement({ multi: () => transaction } as never, {
      now: Date.parse('2026-08-25T12:07:00.000Z'),
      operation: 'status',
      status: 200,
    })

    expect(commands.filter(([command]) => command === 'hincrby')).toHaveLength(4)
    expect(commands.filter(([command]) => command === 'pfadd')).toHaveLength(0)
  })

  test('reports completed operation and group averages against documented capacity', async () => {
    const connection = {
      hgetall: async (key: string) => {
        if (key.includes(':group:status:')) {
          return { requests: '5', weightedTokens: '10' }
        }
        if (key.includes(':operation:status:')) {
          return { requests: '5', weightedTokens: '10' }
        }
        if (key.includes(':group:char-wallet:')) {
          return { requests: '30', weightedTokens: '75' }
        }
        if (key.includes(':operation:wallet-balance:')) {
          return { requests: '18', weightedTokens: '36' }
        }
        return {}
      },
      pfcount: async (key: string) => {
        if (key.includes(':group:char-wallet:')) {
          return 3
        }
        if (key.includes(':operation:wallet-balance:')) {
          return 2
        }
        return 0
      },
    }

    const measurement = await readEsiRateMeasurement(connection as never, {
      now: Date.parse('2026-08-25T12:20:00.000Z'),
    })

    expect(measurement).toMatchObject({
      bucketEndedAt: '2026-08-25T12:15:00.000Z',
      bucketStartedAt: '2026-08-25T12:00:00.000Z',
      complete: true,
    })
    expect(measurement.operations).toContainEqual({
      averageRequestsPerCharacter: 9,
      averageWeightedTokensPerCharacter: 18,
      capacityUsedPercent: 12,
      distinctCharacters: 2,
      group: 'char-wallet',
      operation: 'wallet-balance',
      requests: 18,
      scope: 'character',
      weightedTokens: 36,
    })
    expect(measurement.groups).toContainEqual({
      averageWeightedTokensPerCharacter: 25,
      capacityUsedPercent: 16.6667,
      distinctCharacters: 3,
      group: 'char-wallet',
      maximumTokens: 150,
      requests: 30,
      scope: 'character',
      weightedTokens: 75,
      window: '15m',
    })
    expect(measurement.groups).toContainEqual({
      averageWeightedTokensPerCharacter: null,
      capacityUsedPercent: 1.6667,
      distinctCharacters: null,
      group: 'status',
      maximumTokens: 600,
      requests: 5,
      scope: 'public',
      weightedTokens: 10,
      window: '15m',
    })
  })

  test('rejects invalid offsets and identifies the current window as incomplete', async () => {
    const connection = { hgetall: async () => ({}), pfcount: async () => 0 }

    await expect(readEsiRateMeasurement(connection as never, { windowOffset: -1 })).rejects.toThrow(
      'non-negative integer',
    )
    await expect(
      readEsiRateMeasurement(connection as never, {
        now: Date.parse('2026-08-25T12:07:00.000Z'),
        windowOffset: 0,
      }),
    ).resolves.toMatchObject({ complete: false })
  })
})
