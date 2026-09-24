import { describe, expect, it } from 'vitest';

import {
  ESI_ERROR_BODY_LIMITS,
  EsiAuthenticationRequiredError,
  EsiError,
  EsiGenericMutationDisabledError,
  EsiGenericMutationUnconfirmedError,
  EsiHttpError,
  EsiNotModifiedError,
  EsiRequestValidationError,
  EsiResponseParseError,
  EsiResponseValidationError,
  EsiTransportError,
  EsiUnknownOperationError,
  EsiValidationError,
  classifyEsiFailure,
} from '../src/client/errors.js';

const operationId = 'get_characters_character_id';

describe('ESI structured errors', () => {
  it('provides stable discovery, authentication, and generic mutation codes', () => {
    const unknown = new EsiUnknownOperationError({ operationId: 'missing_operation' });
    const authentication = new EsiAuthenticationRequiredError({
      operationId,
      scopes: ['esi-characters.read_contacts.v1'],
    });
    const disabled = new EsiGenericMutationDisabledError({ operationId });
    const unconfirmed = new EsiGenericMutationUnconfirmedError({ operationId });

    expect(unknown).toBeInstanceOf(EsiError);
    expect(unknown.toJSON()).toStrictEqual({
      code: 'ESI_UNKNOWN_OPERATION',
      message: 'Unknown ESI operation: missing_operation',
      name: 'EsiUnknownOperationError',
      operationId: 'missing_operation',
    });
    expect(authentication.toJSON()).toMatchObject({
      code: 'ESI_AUTHENTICATION_REQUIRED',
      operationId,
      scopes: ['esi-characters.read_contacts.v1'],
    });
    expect(disabled.code).toBe('ESI_GENERIC_MUTATION_DISABLED');
    expect(unconfirmed.code).toBe('ESI_GENERIC_MUTATION_UNCONFIRMED');
  });

  it('skips malformed collection entries without discarding later valid entries', () => {
    const authentication = new EsiAuthenticationRequiredError({
      operationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      scopes: ['before', 123, 'after'] as unknown as string[],
    });
    const response = new EsiResponseParseError({
      metadata: {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        headers: {
          before: 'first',
          malformed: 123,
          after: 'last',
        } as unknown as Record<string, string>,
      },
      operationId,
      status: 200,
    });
    const validation = new EsiRequestValidationError({
      operationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      issues: [
        { code: 'first', message: 'first', path: ['before'] },
        null,
        { code: 'last', message: 'last', path: ['after'] },
      ] as unknown as ConstructorParameters<typeof EsiRequestValidationError>[0]['issues'],
    });

    expect(authentication.scopes).toStrictEqual(['before', 'after']);
    expect(response.metadata.headers).toStrictEqual({ after: 'last', before: 'first' });
    expect(validation.issues).toStrictEqual([
      { code: 'first', message: 'first', path: ['before'] },
      { code: 'last', message: 'last', path: ['after'] },
    ]);
  });

  it('serializes only allowlisted immutable fields and never serializes causes', () => {
    const secret = 'cause-secret-credential';
    const cause = new Error(`provider failed with ${secret}`);
    const error = new EsiUnknownOperationError({
      cause,
      message: `Unknown operation with ${secret}`,
      operationId,
      redaction: { secrets: [secret] },
    });
    const serialized = error.toJSON();

    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(serialized)).toBe(true);
    expect(
      Object.keys(serialized).toSorted((left, right) => left.localeCompare(right)),
    ).toStrictEqual(['code', 'message', 'name', 'operationId']);
    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain('cause');
    expect(JSON.stringify(error)).toBe(JSON.stringify(serialized));
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain('cause');
    expect(() => {
      (error as { code: string }).code = 'changed';
    }).toThrow(TypeError);
  });

  it('includes immutable response metadata without extracting it from a Response', () => {
    const secret = 'metadata-secret-token';
    const headers = {
      Authorization: `Bearer ${secret}`,
      'Set-Cookie': `session=${secret}`,
      'X-Debug': `value ${secret}`,
    };
    const error = new EsiResponseParseError({
      message: `Could not parse Bearer ${secret}`,
      metadata: {
        cache: { etag: secret },
        errorLimit: { remaining: 99, reset: 12 },
        headers,
        pagination: { nextCursor: secret, pages: 2 },
        requestId: `request-${secret}`,
        retryAfterSeconds: 4,
        routeRateLimit: { group: `group-${secret}`, limit: 150, remaining: 148, used: 2 },
      },
      operationId,
      redaction: { secrets: [secret] },
      status: 200,
    });
    headers['X-Debug'] = secret;
    const serialized = JSON.stringify(error);

    expect(error.code).toBe('ESI_RESPONSE_PARSE_ERROR');
    expect(error.metadata).toMatchObject({
      cache: { etag: '[REDACTED]' },
      errorLimit: { remaining: 99, reset: 12 },
      headers: {
        authorization: '[REDACTED]',
        'set-cookie': '[REDACTED]',
        'x-debug': 'value [REDACTED]',
      },
      pagination: { nextCursor: '[REDACTED]', pages: 2 },
      retryAfterSeconds: 4,
      routeRateLimit: {
        group: 'group-[REDACTED]',
        limit: 150,
        remaining: 148,
        used: 2,
      },
      status: 200,
    });
    expect(Object.isFrozen(error.metadata)).toBe(true);
    expect(Object.isFrozen(error.metadata.headers)).toBe(true);
    expect(Object.isFrozen(error.metadata.pagination)).toBe(true);
    expect(Object.isFrozen(error.metadata.routeRateLimit)).toBe(true);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(`Bearer ${secret}`);
  });

  it('parses, redacts, and structurally bounds JSON ESI error bodies', () => {
    const token = 'body-access-token';
    const providerValue = 'provider-return-value';
    let nested: unknown = `deep ${token}`;
    for (let index = 0; index < ESI_ERROR_BODY_LIMITS.depth + 4; index += 1) {
      nested = { nested };
    }
    const responseBody = JSON.stringify({
      access_token: token,
      detail: providerValue,
      error: `Bearer ${token}`,
      nested,
      password: providerValue,
      values: Array.from({ length: ESI_ERROR_BODY_LIMITS.arrayItems + 20 }, (_, index) => index),
    });
    const error = new EsiHttpError({
      metadata: {
        headers: {
          authorization: `Basic ${token}`,
          'x-provider-debug': providerValue,
        },
      },
      operationId,
      redaction: { secrets: [token, providerValue] },
      responseBodyText: responseBody,
      status: 403,
    });
    const serialized = JSON.stringify(error);

    expect(error).toBeInstanceOf(EsiError);
    expect(error.code).toBe('ESI_HTTP_ERROR');
    expect(error.status).toBe(403);
    expect(error.bodyFormat).toBe('json');
    expect(error.bodyTruncated).toBe(true);
    expect(Object.isFrozen(error.body)).toBe(true);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(providerValue);
    expect(serialized).not.toContain(`Basic ${token}`);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized.length).toBeLessThan(ESI_ERROR_BODY_LIMITS.bytes * 2);
  });

  it('falls back to bounded redacted text without parsing an oversized body', () => {
    const secret = 'text-body-secret';
    const error = new EsiHttpError({
      operationId,
      redaction: { secrets: [secret] },
      responseBodyText: `not-json Authorization: ${secret} ${'x'.repeat(50_000)}`,
      status: 502,
    });
    const serialized = JSON.stringify(error);

    expect(error.bodyFormat).toBe('text');
    expect(error.bodyTruncated).toBe(true);
    const body = error.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') {
      throw new TypeError('Expected a text error body');
    }
    expect(body.length).toBeLessThanOrEqual(ESI_ERROR_BODY_LIMITS.characters);
    expect(serialized).not.toContain(secret);
    expect(serialized.length).toBeLessThan(ESI_ERROR_BODY_LIMITS.bytes * 2);
  });

  it('normalizes request and response validation issues without retaining raw input', () => {
    const credential = 'validation-secret-credential';
    const rawInput = { authorization: `Bearer ${credential}`, payload: credential };
    const issues = [
      {
        code: `invalid_${credential}`,
        input: rawInput,
        message: `Expected string, received ${credential}`,
        path: ['body', credential, 3],
      },
    ];
    const request = new EsiRequestValidationError({
      issues,
      operationId,
      redaction: { secrets: [credential] },
    });
    const response = new EsiResponseValidationError({
      issues,
      operationId,
      redaction: { secrets: [credential] },
      status: 200,
    });

    expect(request).toBeInstanceOf(EsiValidationError);
    expect(request).toBeInstanceOf(EsiError);
    expect(request.code).toBe('ESI_REQUEST_VALIDATION_ERROR');
    expect(request.direction).toBe('request');
    expect(response.code).toBe('ESI_RESPONSE_VALIDATION_ERROR');
    expect(response.direction).toBe('response');
    expect(request.issues).toStrictEqual([
      {
        code: 'invalid_[REDACTED]',
        message: 'Expected string, received [REDACTED]',
        path: ['body', '[REDACTED]', 3],
      },
    ]);
    expect(Object.isFrozen(request.issues)).toBe(true);
    expect(Object.isFrozen(request.issues[0])).toBe(true);
    expect(Object.isFrozen(request.issues[0]?.path)).toBe(true);
    expect(JSON.stringify(request)).not.toContain(credential);
    expect(JSON.stringify(request)).not.toContain('authorization');
    expect(JSON.stringify(request)).not.toContain('payload');
    expect(JSON.stringify(response)).not.toContain(credential);
  });

  it('serializes transport and not-modified outcomes without causes or response bodies', () => {
    const secret = 'transport-secret';
    const transport = new EsiTransportError({
      cause: new Error(secret),
      metadata: { headers: { Authorization: `Bearer ${secret}` } },
      operationId,
      phase: 'response',
      reason: 'network',
      redaction: { secrets: [secret] },
      status: 502,
    });
    const notModified = new EsiNotModifiedError({
      metadata: { headers: { etag: 'revision-1' } },
      operationId,
    });

    expect(transport.toJSON()).toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      metadata: { headers: { authorization: '[REDACTED]' } },
      phase: 'response',
      reason: 'network',
      status: 502,
    });
    expect(JSON.stringify(transport)).not.toContain(secret);
    expect(JSON.stringify(transport)).not.toContain('cause');
    expect(notModified.toJSON()).toStrictEqual({
      code: 'ESI_NOT_MODIFIED',
      message: `ESI operation ${operationId} returned an unmodified representation`,
      metadata: { headers: { etag: 'revision-1' }, status: 304 },
      name: 'EsiNotModifiedError',
      operationId,
      status: 304,
    });
    expect(JSON.stringify(notModified)).not.toContain('body');
  });

  it.each([
    [new EsiTransportError({ operationId, phase: 'request', reason: 'network' }), 'transient'],
    [new EsiHttpError({ operationId, status: 503 }), 'transient'],
    [new EsiHttpError({ operationId, status: 429 }), 'throttled'],
    [new EsiNotModifiedError({ operationId }), 'not-modified'],
    [new EsiResponseParseError({ operationId, status: 200 }), 'invalid-response'],
    [new EsiResponseValidationError({ issues: [], operationId, status: 200 }), 'invalid-response'],
    [new EsiHttpError({ operationId, status: 404 }), 'permanent'],
    [new EsiRequestValidationError({ issues: [], operationId }), 'permanent'],
    [new Error('outside the SDK'), 'unknown'],
  ] as const)('classifies policy-neutral failure facts', (error, expected) => {
    expect(classifyEsiFailure(error)).toBe(expected);
  });
});
