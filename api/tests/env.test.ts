import { describe, expect, test } from 'vitest'

import { parseEnvironment } from '../src/env.js'

describe('environment configuration', () => {
  test('provides safe durable queue defaults', () => {
    const env = parseEnvironment({})

    expect(env).toMatchObject({
      QUEUE_REDIS_URL: 'redis://localhost:6379',
      QUEUE_COMPLETED_RETENTION_AGE_SECONDS: 86_400,
      QUEUE_COMPLETED_RETENTION_COUNT: 1_000,
      QUEUE_FAILED_RETENTION_AGE_SECONDS: 604_800,
      QUEUE_FAILED_RETENTION_COUNT: 5_000,
      QUEUE_OPERATION_CONCURRENCY: 10,
      QUEUE_HIGH_WATER_MARK: 1_000,
      QUEUE_PLANNER_SCHEDULE: '*/15 * * * *',
      QUEUE_PLANNER_INITIAL_DELAY_MAX_MS: 60_000,
      QUEUE_LAG_DEGRADED_SECONDS: 300,
      OUTBOX_RELAY_INTERVAL_MS: 5_000,
      OUTBOX_RELAY_BATCH_SIZE: 100,
      OUTBOX_RELAY_CLAIM_TTL_MS: 30_000,
      OUTBOX_RELAY_RETRY_DELAY_MS: 10_000,
      OUTBOX_LAG_DEGRADED_SECONDS: 300,
      DOMAIN_EVENT_PUBLISHED_RETENTION_DAYS: 30,
      WORKER_HEARTBEAT_INTERVAL_MS: 15_000,
      WORKER_SHUTDOWN_TIMEOUT_MS: 30_000,
      DATABASE_POOL_MAX: 10,
      EVE_SSO_TIMEOUT_MS: 15_000,
      TOKEN_REFRESH_LOCK_TIMEOUT_MS: 45_000,
      TOKEN_REFRESH_CONCURRENCY: 4,
      TOKEN_REFRESH_QUEUE_TIMEOUT_MS: 30_000,
      ESI_CACHE_MAX_ENTRIES: 100,
    })
    expect(env.QUEUE_PLANNER_SCHEDULE_OFFSET_MS).toBeUndefined()
  })

  test.each([
    [
      'queue URL',
      { QUEUE_REDIS_URL: 'http://localhost:6379' },
      'Expected a redis:// or rediss:// URL',
    ],
    [
      'retention count',
      { QUEUE_COMPLETED_RETENTION_COUNT: '0' },
      'Too small: expected number to be >0',
    ],
    [
      'planner schedule',
      { QUEUE_PLANNER_SCHEDULE: 'not a cron schedule' },
      'Expected a five- or six-field cron schedule',
    ],
    [
      'planner offset',
      { QUEUE_PLANNER_SCHEDULE_OFFSET_MS: '-1' },
      'Too small: expected number to be >=0',
    ],
    [
      'planner initial delay',
      { QUEUE_PLANNER_INITIAL_DELAY_MAX_MS: '0' },
      'Too small: expected number to be >0',
    ],
  ])('rejects an invalid %s', (_, values, message) => {
    expect(() => parseEnvironment(values)).toThrow(message)
  })

  test.each([
    [
      'a refresh lock that cannot outlast the SSO round-trip it protects',
      { EVE_SSO_TIMEOUT_MS: '10000', TOKEN_REFRESH_LOCK_TIMEOUT_MS: '20000' },
      'Expected more than 20000ms (2 x EVE_SSO_TIMEOUT_MS)',
    ],
    [
      'refresh concurrency that can consume the whole connection pool',
      { DATABASE_POOL_MAX: '10', TOKEN_REFRESH_CONCURRENCY: '10' },
      'Expected fewer than DATABASE_POOL_MAX (10)',
    ],
    [
      'an outbox batch larger than queue admission capacity',
      { QUEUE_HIGH_WATER_MARK: '10', OUTBOX_RELAY_BATCH_SIZE: '11' },
      'Expected no more than QUEUE_HIGH_WATER_MARK (10)',
    ],
    [
      'an outbox claim that can expire before the next relay pass',
      { OUTBOX_RELAY_INTERVAL_MS: '5000', OUTBOX_RELAY_CLAIM_TTL_MS: '5000' },
      'Expected more than OUTBOX_RELAY_INTERVAL_MS (5000)',
    ],
    [
      'an outbox retry delay shorter than the relay interval',
      { OUTBOX_RELAY_INTERVAL_MS: '5000', OUTBOX_RELAY_RETRY_DELAY_MS: '4999' },
      'Expected at least OUTBOX_RELAY_INTERVAL_MS (5000)',
    ],
    [
      'an outbox lag threshold no longer than claim recovery',
      { OUTBOX_RELAY_CLAIM_TTL_MS: '30000', OUTBOX_LAG_DEGRADED_SECONDS: '30' },
      'Expected a duration longer than OUTBOX_RELAY_CLAIM_TTL_MS (30000ms)',
    ],
  ])('rejects %s', (_, values, message) => {
    expect(() => parseEnvironment(values)).toThrow(message)
  })

  test('accepts scaling settings that keep both invariants', () => {
    expect(() =>
      parseEnvironment({
        DATABASE_POOL_MAX: '40',
        EVE_SSO_TIMEOUT_MS: '15000',
        TOKEN_REFRESH_LOCK_TIMEOUT_MS: '45000',
        TOKEN_REFRESH_CONCURRENCY: '16',
      }),
    ).not.toThrow()
  })

  test('accepts a six-field planner schedule', () => {
    expect(
      parseEnvironment({ QUEUE_PLANNER_SCHEDULE: '0 */5 * * * *' }).QUEUE_PLANNER_SCHEDULE,
    ).toBe('0 */5 * * * *')
  })

  test('accepts an explicit planner offset and treats an empty value as the persisted default', () => {
    expect(
      parseEnvironment({ QUEUE_PLANNER_SCHEDULE_OFFSET_MS: '12345' })
        .QUEUE_PLANNER_SCHEDULE_OFFSET_MS,
    ).toBe(12_345)
    expect(
      parseEnvironment({ QUEUE_PLANNER_SCHEDULE_OFFSET_MS: '' }).QUEUE_PLANNER_SCHEDULE_OFFSET_MS,
    ).toBeUndefined()
  })
})
