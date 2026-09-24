import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { EsiHttpError, EsiResponseParseError, EsiTransportError } from '@evespace/esi-client'
import { describe, expect, test, vi } from 'vitest'
import { EveSsoTokenRefreshError } from '../../src/auth/sso.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { TokenRefreshUnavailableError } from '../../src/auth/token-errors.js'
import {
  classifyPlatformResourceFailure,
  PlatformResourceAuthorizationError,
  PlatformResourceMappingError,
  PlatformResourcePersistenceError,
  recordInstalledResourceCollectionFailure,
} from '../../src/platform/resource-failures.js'

const now = new Date('2026-08-26T12:00:00.000Z')
const identity = {
  moduleId: 'member-audit',
  resourceId: 'trained-skills',
  subjectId: '1404328063',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
} as const
const resource = {
  eligibility: { kind: 'current-owned-character' },
  implementation: {
    map: vi.fn(),
    materialize: vi.fn(),
    operation: 'skills',
    request: vi.fn(),
  },
  materializationIntervalSeconds: 900,
  moduleId: identity.moduleId,
  operationId: 'skills',
  resourceId: identity.resourceId,
  subjectKind: 'character',
} as const satisfies PlatformInstalledResourceDescriptor

describe('platform resource failure transitions', () => {
  test('uses the exact typed cooldown deadline', () => {
    expect(
      classifyPlatformResourceFailure(new EsiQuotaError(45, now.getTime()), now),
    ).toStrictEqual({
      failureClass: 'esi-cooldown',
      nextEligibleAt: new Date('2026-08-26T12:00:45.000Z'),
    })
  })

  test('backs off exhausted transport and 5xx failures', () => {
    expect(
      classifyPlatformResourceFailure(
        new EsiTransportError({
          cause: new Error('network'),
          operationId: 'GetStatus',
          phase: 'request',
          reason: 'network',
        }),
        now,
      ),
    ).toStrictEqual({
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date('2026-08-26T12:05:00.000Z'),
    })
    expect(
      classifyPlatformResourceFailure(
        new EsiHttpError({ operationId: 'GetStatus', status: 503 }),
        now,
      ),
    ).toStrictEqual({
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date('2026-08-26T12:05:00.000Z'),
    })
    expect(classifyPlatformResourceFailure(new TokenRefreshUnavailableError(), now)).toStrictEqual({
      failureClass: 'esi-unavailable',
      nextEligibleAt: new Date('2026-08-26T12:05:00.000Z'),
    })
  })

  test('stops the current authorization generation after an upstream refusal', () => {
    expect(
      classifyPlatformResourceFailure(
        new PlatformResourceAuthorizationError(
          new EsiHttpError({ operationId: 'GetStatus', status: 403 }),
        ),
        now,
      ),
    ).toStrictEqual({ failureClass: 'authorization-required', nextEligibleAt: null })
    expect(
      classifyPlatformResourceFailure(new EveSsoTokenRefreshError(400, true), now),
    ).toStrictEqual({
      failureClass: 'authorization-required',
      nextEligibleAt: null,
    })
  })

  test.each([
    [new EsiResponseParseError({ operationId: 'GetStatus', status: 200 }), 'response-invalid'],
    [new PlatformResourceMappingError(new Error('mapper')), 'mapping-failed'],
    [new PlatformResourcePersistenceError(new Error('database')), 'persistence-failed'],
    [new Error('other'), 'unknown'],
  ] as const)('suppresses permanent %s failures as %s', (error, failureClass) => {
    expect(classifyPlatformResourceFailure(error, now)).toStrictEqual({
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
        now,
        resolveEligibility: vi.fn().mockResolvedValue({
          status: 'eligible',
          due: true,
          dueReason: 'elapsed',
          schedulingKey: now,
          authorizationGeneration: 7,
          managedAuthority: null,
          nextEligibleAt: now,
          validatedAt: new Date('2026-08-25T12:00:00.000Z'),
          lastFailureClass: null,
        }),
        resources: [resource],
        upsertState,
      },
    )

    expect(upsertState).toHaveBeenCalledWith({
      ...identity,
      authorizationGeneration: 7,
      lastFailureClass: 'mapping-failed',
      nextEligibleAt: null,
      validatedAt: new Date('2026-08-25T12:00:00.000Z'),
    })
  })

  test('does not attach an old attempt failure to a replacement managed lifecycle', async () => {
    const upsertState = vi.fn()
    const expectedManagedAuthority = {
      disclosureVersion: 1,
      managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
      organizationDeploymentId: 1 as const,
      organizationVersion: 7,
      sectionActivationVersion: 1,
      sectionId: 'skills',
      targetUserId: '00000000-0000-4000-8000-000000000002',
    }

    await recordInstalledResourceCollectionFailure(identity, new Error('old attempt'), {
      expectedAuthorizationGeneration: 7,
      expectedManagedAuthority,
      now,
      resolveEligibility: vi.fn().mockResolvedValue({
        status: 'eligible',
        due: true,
        dueReason: 'never-collected',
        schedulingKey: now,
        authorizationGeneration: 7,
        nextEligibleAt: null,
        validatedAt: null,
        lastFailureClass: null,
        managedAuthority: {
          ...expectedManagedAuthority,
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000021',
        },
      }),
      resources: [
        {
          ...resource,
          sectionId: 'skills',
          eligibility: { kind: 'current-managed-member-character' },
        },
      ],
      upsertState,
    })

    expect(upsertState).not.toHaveBeenCalled()
  })

  test('does not overwrite a success that made the resource current before failure persistence', async () => {
    const upsertState = vi.fn()

    await recordInstalledResourceCollectionFailure(identity, new Error('late failure'), {
      expectedAuthorizationGeneration: 7,
      expectedManagedAuthority: null,
      now,
      resolveEligibility: vi.fn().mockResolvedValue({
        status: 'eligible',
        due: false,
        dueReason: 'future',
        schedulingKey: new Date('2026-08-26T12:15:00.000Z'),
        authorizationGeneration: 7,
        nextEligibleAt: new Date('2026-08-26T12:15:00.000Z'),
        validatedAt: now,
        lastFailureClass: null,
        managedAuthority: null,
      }),
      resources: [resource],
      upsertState,
    })

    expect(upsertState).not.toHaveBeenCalled()
  })
})
