import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { describe, expect, test, vi } from 'vitest'
import { EsiQuotaError } from '../../src/esi-resilience/cooldowns.js'
import { EsiTransportError } from '../../src/esi-resilience/transport.js'
import { TokenRefreshUnavailableError } from '../../src/auth/tokens.js'
import {
  classifyPlatformResourceFailure,
  PlatformResourceMappingError,
  PlatformResourcePersistenceError,
  recordInstalledResourceCollectionFailure,
} from '../../src/platform/resource-failures.js'

const now = new Date('2026-08-26T12:00:00.000Z')
const identity = {
  moduleId: 'member-audit',
  resourceId: 'trained-skills',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
  subjectId: '1404328063',
} as const
const resource = {
  moduleId: identity.moduleId,
  resourceId: identity.resourceId,
  operationId: 'skills',
  subjectKind: 'character',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation: {
    operation: 'skills',
    request: vi.fn(),
    map: vi.fn(),
    materialize: vi.fn(),
  },
} as const satisfies PlatformInstalledResourceDescriptor

describe('platform resource failure transitions', () => {
  test('uses the exact typed cooldown deadline', () => {
    expect(classifyPlatformResourceFailure(new EsiQuotaError(45, now.getTime()), now)).toEqual({
      failureClass: 'esi-cooldown',
      nextEligibleAt: new Date('2026-08-26T12:00:45.000Z'),
    })
  })

  test('backs off exhausted transport and 5xx failures', () => {
    expect(
      classifyPlatformResourceFailure(new EsiTransportError(new Error('network')), now),
    ).toEqual({
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date('2026-08-26T12:05:00.000Z'),
    })
    expect(classifyPlatformResourceFailure({ code: 'ESI_HTTP_ERROR', status: 503 }, now)).toEqual({
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date('2026-08-26T12:05:00.000Z'),
    })
    expect(classifyPlatformResourceFailure(new TokenRefreshUnavailableError(), now)).toEqual({
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date('2026-08-26T12:05:00.000Z'),
    })
  })

  test.each([
    [{ code: 'ESI_RESPONSE_PARSE_ERROR' }, 'response-invalid'],
    [new PlatformResourceMappingError(new Error('mapper')), 'mapping-failed'],
    [new PlatformResourcePersistenceError(new Error('database')), 'persistence-failed'],
    [new Error('other'), 'unknown'],
  ] as const)('suppresses permanent %s failures as %s', (error, failureClass) => {
    expect(classifyPlatformResourceFailure(error, now)).toEqual({
      failureClass,
      nextEligibleAt: null,
    })
  })

  test('preserves validated state while writing only sanitized failure metadata', async () => {
    const upsertState = vi.fn().mockResolvedValue(undefined)

    await recordInstalledResourceCollectionFailure(
      identity,
      new PlatformResourceMappingError(new Error('secret response body')),
      {
        resources: [resource],
        now,
        resolveEligibility: vi.fn().mockResolvedValue({
          status: 'eligible',
          due: true,
          dueReason: 'elapsed',
          schedulingKey: now,
          authorizationGeneration: 7,
          nextEligibleAt: now,
          validatedAt: new Date('2026-08-25T12:00:00.000Z'),
          lastFailureClass: null,
        }),
        upsertState,
      },
    )

    expect(upsertState).toHaveBeenCalledWith({
      ...identity,
      nextEligibleAt: null,
      authorizationGeneration: 7,
      validatedAt: new Date('2026-08-25T12:00:00.000Z'),
      lastFailureClass: 'mapping-failed',
    })
  })
})
