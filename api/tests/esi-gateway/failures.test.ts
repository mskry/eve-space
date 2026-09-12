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
      label: 'request transport timeout',
      error: new EsiTransportError({
        operationId,
        reason: 'timeout',
        phase: 'request',
      }),
      retryable: true,
      staleClass: 'esi-unavailable',
    },
    {
      label: 'response transport failure with a server status',
      error: new EsiTransportError({
        operationId,
        reason: 'network',
        phase: 'response',
        status: 503,
      }),
      retryable: true,
      staleClass: 'esi-unavailable',
    },
    {
      label: 'response transport failure with a client status',
      error: new EsiTransportError({
        operationId,
        reason: 'network',
        phase: 'response',
        status: 400,
      }),
      retryable: false,
      staleClass: 'unknown',
    },
    {
      label: 'HTTP server failure',
      error: new EsiHttpError({ operationId, status: 503 }),
      retryable: true,
      staleClass: 'esi-unavailable',
    },
    {
      label: 'HTTP client failure',
      error: new EsiHttpError({ operationId, status: 404 }),
      retryable: false,
      staleClass: 'unknown',
    },
    {
      label: 'response parse failure',
      error: new EsiResponseParseError({ operationId, status: 200 }),
      retryable: false,
      staleClass: 'response-invalid',
    },
    {
      label: 'response validation failure',
      error: new EsiResponseValidationError({ operationId, status: 200, issues: [] }),
      retryable: false,
      staleClass: 'response-invalid',
    },
    {
      label: 'unknown failure',
      error: new Error('outside the SDK'),
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
      operationId,
      metadata: {
        headers: { etag: 'status-v1' },
        cache: { cacheControl: 'max-age=30', maxAgeSeconds: 30 },
      },
    })

    expect(getEsiFailureStatus(error)).toBe(304)
    expect(getEsiResponseErrorMetadata(error)).toStrictEqual({
      status: 304,
      headers: { etag: 'status-v1' },
      cache: { cacheControl: 'max-age=30', maxAgeSeconds: 30 },
    })
    expect(shouldRetryEsiError(error, incompleteErrors)).toBe(false)
  })

  test('converts a typed throttling response using SDK Retry-After metadata', () => {
    const error = new EsiHttpError({
      operationId,
      status: 429,
      metadata: { headers: {}, retryAfterSeconds: 12 },
    })

    const converted = toEsiQuotaError(error)

    expect(converted).toBeInstanceOf(EsiQuotaError)
    expect(converted).toMatchObject({ retryAfterSeconds: 12 })
  })

  test('treats typed transport and invalid-response failures as mutation-ambiguous', () => {
    const mutation = getEsiOperationContract('mail-send')
    const failures = [
      new EsiTransportError({ operationId, reason: 'network', phase: 'request' }),
      new EsiResponseParseError({ operationId, status: 200 }),
      new EsiResponseValidationError({ operationId, status: 200, issues: [] }),
    ]

    for (const failure of failures)
      expect(shouldAdvanceRevisionAfterMutationError(mutation, failure)).toBe(true)
    expect(
      shouldAdvanceRevisionAfterMutationError(mutation, new EsiNotModifiedError({ operationId })),
    ).toBe(false)
  })

  test('returns a safe stable classification without retaining raw dependency errors', () => {
    const cause = new Error('socket failed at redis://cache.internal:6379 with bearer-secret')
    const failure = classifyEsiOperationFailure(
      new EsiTransportError({ operationId, reason: 'network', phase: 'request', cause }),
    )

    expect(failure).toEqual({ kind: 'unavailable' })
    expect(JSON.stringify(failure)).not.toContain('redis://')
    expect(JSON.stringify(failure)).not.toContain('bearer-secret')
    expect(failure).not.toHaveProperty('cause')
    expect(failure).not.toHaveProperty('metadata')
  })
})
