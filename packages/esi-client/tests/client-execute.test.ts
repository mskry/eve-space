import { describe, expect, it, vi } from 'vitest';

import { EsiClientConfiguration } from '../src/client/configuration.js';
import {
  EsiAuthenticationRequiredError,
  EsiHttpError,
  EsiNotModifiedError,
  EsiRequestValidationError,
  EsiResponseParseError,
  EsiResponseValidationError,
  EsiTransportError,
} from '../src/client/errors.js';
import { executeOperation } from '../src/client/execute.js';
import type { OperationExecutionDescriptor } from '../src/client/execute.js';
import type { OperationRequestArguments, OperationSchema } from '../src/client/request.js';

describe('shared descriptor execution', () => {
  it('constructs one JSON request with configured transport headers and custom fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ id: 7 }, { headers: { 'x-request-id': 'request-1' } }),
    );
    const configuration = new EsiClientConfiguration({
      baseUrl: 'https://esi.example/api/',
      compatibilityDate: '2026-01-02',
      language: 'ja',
      fetch,
    });
    const descriptor = operation<{ readonly body: { readonly name: string } }>({
      method: 'POST',
      requestBody: { required: true, mediaType: 'application/json' },
    });

    const result = await executeOperation(configuration, descriptor, { body: { name: 'Venture' } });

    expect(result.data).toEqual({ id: 7 });
    expect(result.meta.status).toBe(200);
    expect(result.meta.headers['x-request-id']).toBe('request-1');
    expect(result.meta.requestId).toBe('request-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = onlyFetchCall(fetch);
    const headers = new Headers(init?.headers);
    expect(url).toBe('https://esi.example/api/items');
    expect(init).toMatchObject({ method: 'POST', body: '{"name":"Venture"}' });
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('accept-language')).toBe('ja');
    expect(headers.get('x-compatibility-date')).toBe('2026-01-02');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
  });

  it('invokes fetch without using the configuration as its receiver', async () => {
    let receiverWasUndefined = false;
    const fetch = function (this: unknown): Promise<Response> {
      receiverWasUndefined = this === undefined;
      return Promise.resolve(Response.json({ ok: true }));
    } as typeof globalThis.fetch;

    await executeOperation(new EsiClientConfiguration({ fetch }), operation(), {});

    expect(receiverWasUndefined).toBe(true);
  });

  it('uses a descriptor-gated per-call compatibility-date override', async () => {
    const fetch = jsonFetch({ ok: true });
    const descriptor = operation({ transport: { compatibilityDateOverride: true } });

    await executeOperation(
      new EsiClientConfiguration({ fetch }),
      descriptor,
      {},
      {
        compatibilityDate: '2025-06-07',
      },
    );

    const headers = new Headers(onlyFetchCall(fetch)[1]?.headers);
    expect(headers.get('x-compatibility-date')).toBe('2025-06-07');
    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch }),
        operation(),
        {},
        { compatibilityDate: '2025-06-07' },
      ),
    ).rejects.toBeInstanceOf(EsiRequestValidationError);
  });

  it('never resolves credentials for public operations', async () => {
    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'public-operation-secret');
    const fetch = jsonFetch({ ok: true });

    await executeOperation(new EsiClientConfiguration({ tokenProvider, fetch }), operation(), {});

    expect(tokenProvider).not.toHaveBeenCalled();
    expect(new Headers(onlyFetchCall(fetch)[1]?.headers).has('authorization')).toBe(false);
  });

  it('resolves deferred credentials after validation and immediately before fetch', async () => {
    const events: string[] = [];
    const requestSchema = schema<OperationRequestArguments>((value) => {
      events.push('validate');
      expect(value).toEqual({});
      return { success: true, data: {} };
    });
    const tokenProvider = vi.fn<() => Promise<string>>(async () => {
      events.push('token');
      return 'deferred-secret';
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      events.push('fetch');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer deferred-secret');
      return Response.json({ ok: true });
    });
    const descriptor = authenticatedOperation({ requestSchema });

    await executeOperation(
      new EsiClientConfiguration({ tokenProvider, fetch, validateRequests: true }),
      descriptor,
      {},
    );

    expect(events).toEqual(['validate', 'token', 'fetch']);
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('starts the transport deadline after deferred credential resolution', async () => {
    const tokenProvider = vi.fn<() => Promise<string>>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return 'deferred-secret';
    });
    const fetch = jsonFetch({ ok: true });

    await expect(
      executeOperation(
        new EsiClientConfiguration({ tokenProvider, fetch, requestTimeoutMs: 5 }),
        authenticatedOperation(),
        {},
      ),
    ).resolves.toMatchObject({ data: { ok: true } });
  });

  it('stops waiting for deferred credentials when the caller cancels', async () => {
    let resolveToken: ((token: string) => void) | undefined;
    const tokenProvider = vi.fn<() => Promise<string>>(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const fetch = jsonFetch({ unreachable: true });
    const controller = new AbortController();
    const promise = executeOperation(
      new EsiClientConfiguration({ tokenProvider, fetch }),
      authenticatedOperation(),
      {},
      { signal: controller.signal },
    );

    controller.abort(new Error('caller cancelled'));

    await expect(promise).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      reason: 'network',
      phase: 'request',
    });
    expect(fetch).not.toHaveBeenCalled();
    resolveToken?.('late-secret');
  });

  it('requires credentials with scopes before network activity', async () => {
    const fetch = jsonFetch({ unreachable: true });

    const promise = executeOperation(
      new EsiClientConfiguration({ fetch }),
      authenticatedOperation(),
      {},
    );

    await expect(promise).rejects.toMatchObject({
      code: 'ESI_AUTHENTICATION_REQUIRED',
      scopes: ['esi-items.read.v1'],
    });
    await expect(promise).rejects.toBeInstanceOf(EsiAuthenticationRequiredError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates requests only by policy or force flag and uses parsed arguments', async () => {
    const requestSchema = schema<OperationRequestArguments>(() => ({
      success: true,
      data: { query: { page: 3 } },
    }));
    const descriptor = operation({
      parameters: [
        { name: 'page', placement: 'query', required: false, schema: { type: 'integer' } },
      ],
      requestSchema,
    });
    const defaultFetch = jsonFetch({ ok: true });
    await executeOperation(new EsiClientConfiguration({ fetch: defaultFetch }), descriptor, {});
    expect(requestSchema.safeParse).not.toHaveBeenCalled();
    expect(onlyFetchCall(defaultFetch)[0]).toBe('https://esi.evetech.net/items');

    const policyFetch = jsonFetch({ ok: true });
    await executeOperation(
      new EsiClientConfiguration({ fetch: policyFetch, validateRequests: true }),
      descriptor,
      {},
    );
    expect(onlyFetchCall(policyFetch)[0]).toBe('https://esi.evetech.net/items?page=3');

    const forcedFetch = jsonFetch({ ok: true });
    await executeOperation(
      new EsiClientConfiguration({ fetch: forcedFetch }),
      descriptor,
      {},
      {
        forceRequestValidation: true,
      },
    );
    expect(onlyFetchCall(forcedFetch)[0]).toBe('https://esi.evetech.net/items?page=3');
    expect(requestSchema.safeParse).toHaveBeenCalledTimes(2);
  });

  it('rejects AbortSignal lookalikes before network activity', async () => {
    const fetch = jsonFetch({ unreachable: true });
    const signal: AbortSignal = {
      aborted: false,
      reason: undefined,
      onabort: null,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
      throwIfAborted() {},
    };

    const promise = executeOperation(
      new EsiClientConfiguration({ fetch }),
      operation(),
      {},
      { signal },
    );

    await expect(promise).rejects.toMatchObject({
      code: 'ESI_REQUEST_VALIDATION_ERROR',
      issues: [{ path: ['signal'], code: 'invalid_type' }],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ validateRequests: true }, {}],
    [{}, { forceRequestValidation: true }],
  ] as const)(
    'rejects invalid request arguments before network',
    async (clientOptions, options) => {
      const fetch = jsonFetch({ unreachable: true });
      const descriptor = operation({
        requestSchema: failingSchema<OperationRequestArguments>('request-secret'),
      });

      const promise = executeOperation(
        new EsiClientConfiguration({ fetch, ...clientOptions }),
        descriptor,
        {},
        options,
      );

      await expect(promise).rejects.toBeInstanceOf(EsiRequestValidationError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('selects the status-specific response schema and returns validated JSON', async () => {
    const exact = schema<{ readonly selected: string }>(() => ({
      success: true,
      data: { selected: 'exact' },
    }));
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ selected: 'wire' }, { status: 201 }),
    );
    const descriptor = operation({
      successResponses: [{ status: 201, body: 'json', schema: exact }],
    });

    const result = await executeOperation(new EsiClientConfiguration({ fetch }), descriptor, {});

    expect(result.data).toEqual({ selected: 'exact' });
    expect(exact.safeParse).toHaveBeenCalledWith({ selected: 'wire' });
  });

  it('validates responses by default and skips validation when disabled', async () => {
    const responseSchema = failingSchema('response-secret');
    const descriptor = operation({ responseSchema });
    const enabled = executeOperation(
      new EsiClientConfiguration({ fetch: jsonFetch({ value: 'bad' }) }),
      descriptor,
      {},
    );
    await expect(enabled).rejects.toBeInstanceOf(EsiResponseValidationError);

    const result = await executeOperation(
      new EsiClientConfiguration({
        fetch: jsonFetch({ value: 'unvalidated' }),
        validateResponses: false,
      }),
      descriptor,
      {},
    );
    expect(result.data).toEqual({ value: 'unvalidated' });
    expect(responseSchema.safeParse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['declared 200 no-content', 200, [{ status: 200, body: 'none' }] as const],
    ['actual 204', 204, [{ status: 204, body: 'json', schema: passthroughSchema }] as const],
    ['actual 205', 205, [{ status: 205, body: 'json', schema: passthroughSchema }] as const],
  ])('returns undefined without parsing JSON for %s', async (_name, status, successResponses) => {
    const json = vi.fn<() => Promise<never>>(async () => {
      throw new Error('JSON must not be parsed');
    });
    const response = new Response(null, { status });
    Object.defineProperty(response, 'json', { value: json });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const descriptor = operation({ successResponses });

    const result = await executeOperation(new EsiClientConfiguration({ fetch }), descriptor, {});

    expect(result.data).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('cancels an unexpected body for a declared no-content response', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body));
    const descriptor = operation({ successResponses: [{ status: 200, body: 'none' }] });

    await executeOperation(new EsiClientConfiguration({ fetch }), descriptor, {});

    expect(cancelled).toBe(true);
  });

  it('throws a structured parse error for a successful non-JSON body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response('not JSON', { status: 200, headers: { 'x-request-id': 'parse-request' } }),
    );

    const promise = executeOperation(new EsiClientConfiguration({ fetch }), operation(), {});

    await expect(promise).rejects.toBeInstanceOf(EsiResponseParseError);
    await expect(promise).rejects.toMatchObject({
      code: 'ESI_RESPONSE_PARSE_ERROR',
      status: 200,
      metadata: { headers: { 'x-request-id': 'parse-request' } },
    });
  });

  it('returns a timeout transport error when fetch ignores cancellation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      reason: 'timeout',
      phase: 'request',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps a synchronous configured-fetch failure to a transport error', async () => {
    const failure = new TypeError('network unavailable');
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      throw failure;
    });

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch }), operation(), {}),
    ).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      reason: 'network',
      phase: 'request',
      cause: failure,
    });
  });

  it('returns a timeout transport error when fetch observes cancellation', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined;
          observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), {
            once: true,
          });
        }),
    );

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({ reason: 'timeout', phase: 'request' });
    expect(observedSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('composes caller cancellation with the SDK deadline', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const promise = executeOperation(
      new EsiClientConfiguration({ fetch, requestTimeoutMs: 1_000 }),
      operation(),
      {},
      { signal: controller.signal },
    );

    controller.abort(new Error('caller cancelled'));

    await expect(promise).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      reason: 'network',
      phase: 'request',
    });
  });

  it('maps response-stream failures separately from completed invalid JSON', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 200 }));

    const promise = executeOperation(new EsiClientConfiguration({ fetch }), operation(), {});

    await expect(promise).rejects.toBeInstanceOf(EsiTransportError);
    await expect(promise).rejects.toMatchObject({
      reason: 'network',
      phase: 'response',
      status: 200,
    });
  });

  it('times out while consuming a stalled response body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 200 }));

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({ reason: 'timeout', phase: 'response', status: 200 });
  });

  it('handles a rejected reader cancellation after a response timeout', async () => {
    const cancel = vi.fn<() => Promise<void>>(async () => {
      throw new Error('stream cancellation failed');
    });
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 200 }));

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({ reason: 'timeout', phase: 'response', status: 200 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('times out while consuming a stalled error response body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 503 }));

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({ reason: 'timeout', phase: 'response', status: 503 });
  });

  it('returns a dedicated not-modified outcome with metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 304, headers: { ETag: 'revision-2' } }),
    );

    const promise = executeOperation(new EsiClientConfiguration({ fetch }), operation(), {});

    await expect(promise).rejects.toBeInstanceOf(EsiNotModifiedError);
    await expect(promise).rejects.toMatchObject({
      code: 'ESI_NOT_MODIFIED',
      status: 304,
      metadata: { cache: { etag: 'revision-2' } },
    });
  });

  it.each([429, 503])('performs one fetch attempt for HTTP %s', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ error: 'failed' }, { status }),
    );

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch }), operation(), {}),
    ).rejects.toBeInstanceOf(EsiHttpError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws a bounded structured HTTP error and serializes no credentials', async () => {
    const secret = 'http-token-secret';
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ error: `Bearer ${secret}`, detail: 'x'.repeat(30_000) }), {
          status: 403,
          headers: { 'x-request-id': 'http-request' },
        }),
    );

    let thrown: unknown;
    try {
      await executeOperation(
        new EsiClientConfiguration({ token: secret, fetch }),
        authenticatedOperation(),
        {},
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EsiHttpError);
    expect(thrown).toMatchObject({ status: 403, bodyTruncated: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(thrown)).not.toContain(secret);
    expect(JSON.stringify(thrown)).not.toContain('authorization');
  });

  it('keeps validation failures secret-free with Zod-like issues only', async () => {
    const secret = 'validation-token-secret';
    const descriptor = authenticatedOperation({ responseSchema: failingSchema(secret) });
    let thrown: unknown;
    try {
      await executeOperation(
        new EsiClientConfiguration({
          token: secret,
          fetch: async () =>
            Response.json({ value: 'bad' }, { headers: { 'cache-control': 'public, max-age=30' } }),
        }),
        descriptor,
        {},
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EsiResponseValidationError);
    expect(JSON.stringify(thrown)).not.toContain(secret);
    expect(JSON.stringify(thrown)).not.toContain('authorization');
    expect(thrown).toMatchObject({
      issues: [{ path: ['body', '[REDACTED]'], code: 'invalid_[REDACTED]' }],
      metadata: { cache: { maxAgeSeconds: 30 } },
    });
  });
});

const passthroughSchema: OperationSchema = {
  safeParse: (value: unknown) => ({ success: true, data: value }),
};

function operation<TArguments extends OperationRequestArguments = OperationRequestArguments>(
  overrides: Partial<OperationExecutionDescriptor<TArguments>> & {
    readonly responseSchema?: OperationSchema;
  } = {},
): OperationExecutionDescriptor<TArguments> {
  const { responseSchema = passthroughSchema, ...descriptorOverrides } = overrides;
  return {
    operationId: 'get_items',
    method: 'GET',
    path: '/items',
    parameters: [],
    requestBody: null,
    authentication: null,
    protocol: {
      cache: { responseHeaders: [], extensions: {} },
      conditionalRequestValidators: [],
      rateLimit: { kind: 'legacy-only' },
      requestArrayLimits: [],
      maximumBatchSize: null,
    },
    successResponses: [{ status: 200, body: 'json', schema: responseSchema }],
    ...descriptorOverrides,
  };
}

function authenticatedOperation<
  TArguments extends OperationRequestArguments = OperationRequestArguments,
>(
  overrides: Partial<OperationExecutionDescriptor<TArguments>> & {
    readonly responseSchema?: OperationSchema;
  } = {},
): OperationExecutionDescriptor<TArguments> {
  return operation({
    authentication: { scopes: ['esi-items.read.v1'] },
    ...overrides,
  });
}

function schema<T>(
  implementation: (value: unknown) => ReturnType<OperationSchema<T>['safeParse']>,
): OperationSchema<T> {
  return { safeParse: vi.fn<OperationSchema<T>['safeParse']>(implementation) };
}

function failingSchema<T = unknown>(secret: string): OperationSchema<T> {
  return schema<T>(() => ({
    success: false,
    error: {
      issues: [
        {
          path: ['body', secret],
          message: `Invalid value ${secret}`,
          code: `invalid_${secret}`,
        },
      ],
    },
  }));
}

function jsonFetch(data: unknown): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async () => Response.json(data));
}

function onlyFetchCall(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
): [string | URL | Request, RequestInit | undefined] {
  const call = fetch.mock.calls[0];
  if (call === undefined) throw new Error('Expected fetch to be called');
  return [call[0], call[1]];
}
