import {
  EsiHttpError,
  EsiNotModifiedError,
  EsiResponseParseError,
  EsiResponseValidationError,
  EsiTransportError,
} from '@evespace/esi-client'
import { describe, expect, test } from 'vitest'
import { getEsiOperationContract } from '../../src/esi-gateway/internal/catalog-access.js'
import {
  classifyEsiOperationFailure,
  classifyEsiRefreshFailure,
  EsiQuotaError,
  getEsiFailureStatus,
} from '../../src/esi-gateway/failures.js'
import {
  shouldAdvanceRevisionAfterMutationError,
  shouldRetryEsiError,
  toEsiQuotaError,
} from '../../src/esi-gateway/internal/failure-policy.js'
import { getEsiResponseErrorMetadata } from '../../src/esi-gateway/internal/response-error-metadata.js'

const operationId = 'GetStatus'
const incompleteErrors = { isErrorCompleted: () => false, markErrorCompleted: () => {} }

describe('application ESI failure compatibility', () => {
  test.each([
    {
      error: new EsiTransportError({
        operationId,
        reason: 'timeout',
        phase: 'request',
      }),
      label: 'request transport timeout',
      retryable: true,
      staleClass: 'esi-unavailable',
    },
    {
      error: new EsiTransportError({
        operationId,
        reason: 'network',
        phase: 'response',
        status: 503,
      }),
      label: 'response transport failure with a server status',
      retryable: true,
      staleClass: 'esi-unavailable',
    },
    {
      error: new EsiTransportError({
        operationId,
        reason: 'network',
        phase: 'response',
        status: 400,
      }),
      label: 'response transport failure with a client status',
      retryable: false,
      staleClass: 'unknown',
    },
    {
      error: new EsiHttpError({ operationId, status: 503 }),
      label: 'HTTP server failure',
      retryable: true,
      staleClass: 'esi-unavailable',
    },
    {
      error: new EsiHttpError({ operationId, status: 404 }),
      label: 'HTTP client failure',
      retryable: false,
      staleClass: 'unknown',
    },
    {
      error: new EsiResponseParseError({ operationId, status: 200 }),
      label: 'response parse failure',
      retryable: false,
      staleClass: 'response-invalid',
    },
    {
      error: new EsiResponseValidationError({ operationId, status: 200, issues: [] }),
      label: 'response validation failure',
      retryable: false,
      staleClass: 'response-invalid',
    },
    {
      error: new Error('outside the SDK'),
      label: 'unknown failure',
      retryable: false,
      staleClass: 'unknown',
    },
  ] as const)(
    'classifies $label through the current application policy',
    ({ error, retryable, staleClass }) => {
      expect(shouldRetryEsiError(error, incompleteErrors)).toBe(retryable)
      expect(classifyEsiRefreshFailure(error)).toBe(staleClass)
    },
  )

  test('recovers typed not-modified status and metadata', () => {
    const error = new EsiNotModifiedError({
      metadata: {
        cache: { cacheControl: 'max-age=30', maxAgeSeconds: 30 },
        headers: { etag: 'status-v1' },
      },
      operationId,
    })

    expect(getEsiFailureStatus(error)).toBe(304)
    expect(getEsiResponseErrorMetadata(error)).toStrictEqual({
      cache: { cacheControl: 'max-age=30', maxAgeSeconds: 30 },
      headers: { etag: 'status-v1' },
      status: 304,
    })
    expect(shouldRetryEsiError(error, incompleteErrors)).toBe(false)
  })

  test('converts a typed throttling response using SDK Retry-After metadata', () => {
    const error = new EsiHttpError({
      metadata: { headers: {}, retryAfterSeconds: 12 },
      operationId,
      status: 429,
    })

    const converted = toEsiQuotaError(error)

    expect(converted).toBeInstanceOf(EsiQuotaError)
    expect(converted).toMatchObject({ retryAfterSeconds: 12 })
  })

  test('treats typed transport and invalid-response failures as mutation-ambiguous', () => {
    const mutation = getEsiOperationContract('mail-send')
    const failures = [
      new EsiTransportError({ operationId, phase: 'request', reason: 'network' }),
      new EsiResponseParseError({ operationId, status: 200 }),
      new EsiResponseValidationError({ issues: [], operationId, status: 200 }),
    ]

    for (const failure of failures) {
      expect(shouldAdvanceRevisionAfterMutationError(mutation, failure)).toBe(true)
    }
    expect(
      shouldAdvanceRevisionAfterMutationError(mutation, new EsiNotModifiedError({ operationId })),
    ).toBe(false)
  })

  test('returns a safe stable classification without retaining raw dependency errors', () => {
    const cause = new Error('socket failed at redis://cache.internal:6379 with bearer-secret')
    const failure = classifyEsiOperationFailure(
      new EsiTransportError({ cause, operationId, phase: 'request', reason: 'network' }),
    )

    expect(failure).toStrictEqual({ kind: 'unavailable' })
    expect(JSON.stringify(failure)).not.toContain('redis://')
    expect(JSON.stringify(failure)).not.toContain('bearer-secret')
    expect(failure).not.toHaveProperty('cause')
    expect(failure).not.toHaveProperty('metadata')
  })
})
