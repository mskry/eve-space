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
import { executeOperation, type OperationExecutionDescriptor } from '../src/client/execute.js';
import type { EsiTokenProvider } from '../src/client/options.js';
import type { OperationRequestArguments, OperationSchema } from '../src/client/request.js';

describe('shared descriptor execution', () => {
  it('constructs one JSON request with configured transport headers and custom fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ id: 7 }, { headers: { 'x-request-id': 'request-1' } }),
    );
    const configuration = new EsiClientConfiguration({
      baseUrl: 'https://esi.example/api/',
      compatibilityDate: '2026-01-02',
      fetch,
      language: 'ja',
    });
    const descriptor = operation<{ readonly body: { readonly name: string } }>({
      method: 'POST',
      requestBody: { mediaType: 'application/json', required: true },
    });

    const result = await executeOperation(configuration, descriptor, { body: { name: 'Venture' } });

    expect(result.data).toStrictEqual({ id: 7 });
    expect(result.meta.status).toBe(200);
    expect(result.meta.headers['x-request-id']).toBe('request-1');
    expect(result.meta.requestId).toBe('request-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = onlyFetchCall(fetch);
    const headers = new Headers(init?.headers);
    expect(url).toBe('https://esi.example/api/items');
    expect(init).toMatchObject({ body: '{"name":"Venture"}', method: 'POST' });
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

    await executeOperation(new EsiClientConfiguration({ fetch, tokenProvider }), operation(), {});

    expect(tokenProvider).not.toHaveBeenCalled();
    expect(new Headers(onlyFetchCall(fetch)[1]?.headers).has('authorization')).toBe(false);
  });

  it('resolves deferred credentials after validation and immediately before fetch', async () => {
    const events: string[] = [];
    const requestSchema = schema<OperationRequestArguments>((value) => {
      events.push('validate');
      expect(value).toStrictEqual({});
      return { data: {}, success: true };
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
      new EsiClientConfiguration({ fetch, tokenProvider, validateRequests: true }),
      descriptor,
      {},
    );

    expect(events).toStrictEqual(['validate', 'token', 'fetch']);
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
        new EsiClientConfiguration({ fetch, requestTimeoutMs: 5, tokenProvider }),
        authenticatedOperation(),
        {},
      ),
    ).resolves.toMatchObject({ data: { ok: true } });
  });
});

describe('credential and request cancellation', () => {
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
      new EsiClientConfiguration({ fetch, tokenProvider }),
      authenticatedOperation(),
      {},
      { signal: controller.signal },
    );

    controller.abort(new Error('caller cancelled'));

    await expect(promise).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      phase: 'request',
      reason: 'network',
    });
    expect(fetch).not.toHaveBeenCalled();
    resolveToken?.('late-secret');
  });

  it.each(['provider', 'public', 'direct token'] as const)(
    'does not start credentials or transport for a pre-aborted %s call',
    async (mode) => {
      const controller = new AbortController();
      controller.abort(new Error('cancelled before execution'));
      const fetch = jsonFetch({ unreachable: true });
      const tokenProvider = vi.fn<EsiTokenProvider>(async () => 'deferred-secret');
      const configuration = new EsiClientConfiguration({
        fetch,
        ...(mode === 'direct token' ? { token: 'direct-secret' } : { tokenProvider }),
      });

      await expect(
        executeOperation(
          configuration,
          mode === 'public' ? operation() : authenticatedOperation(),
          {},
          {
            signal: controller.signal,
          },
        ),
      ).rejects.toMatchObject({ phase: 'request', reason: 'network' });
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('passes caller cancellation to a cooperating provider and keeps its failure in the request phase', async () => {
    const controller = new AbortController();
    let providedSignal: AbortSignal | undefined;
    const tokenProvider = vi.fn<EsiTokenProvider>(
      async (context?: { readonly signal?: AbortSignal }): Promise<string> => {
        providedSignal = context?.signal;
        return await new Promise((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () => reject(context.signal?.reason), {
            once: true,
          });
        });
      },
    );
    const fetch = jsonFetch({ unreachable: true });
    const promise = executeOperation(
      new EsiClientConfiguration({ fetch, tokenProvider }),
      authenticatedOperation(),
      {},
      { signal: controller.signal },
    );

    expect(providedSignal).toBe(controller.signal);
    controller.abort(new Error('provider stopped'));
    await expect(promise).rejects.toMatchObject({ phase: 'request', reason: 'network' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps caller cancellation over a provider failure and preserves ordinary provider errors', async () => {
    const controller = new AbortController();
    const failure = new Error('provider failed');
    const fetch = jsonFetch({ unreachable: true });
    const tokenProvider = vi.fn<EsiTokenProvider>(async () => {
      controller.abort(failure);
      throw failure;
    });

    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch, tokenProvider }),
        authenticatedOperation(),
        {},
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ phase: 'request', reason: 'network' });
    await expect(
      executeOperation(
        new EsiClientConfiguration({
          fetch,
          tokenProvider: async () => {
            throw failure;
          },
        }),
        authenticatedOperation(),
        {},
      ),
    ).rejects.toBeInstanceOf(EsiAuthenticationRequiredError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not start scheduled fetch after cancellation', async () => {
    const controller = new AbortController();
    const fetch = jsonFetch({ unreachable: true });
    const promise = executeOperation(
      new EsiClientConfiguration({ fetch }),
      operation(),
      {},
      { signal: controller.signal },
    );
    controller.abort();

    await expect(promise).rejects.toMatchObject({ phase: 'request', reason: 'network' });
    expect(fetch).not.toHaveBeenCalled();
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
      data: { query: { page: 3 } },
      success: true,
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
      addEventListener() {},
      dispatchEvent: () => true,
      onabort: null,
      reason: undefined,
      removeEventListener() {},
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
      issues: [{ code: 'invalid_type', path: ['signal'] }],
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
});

describe('response completion and cancellation', () => {
  it('selects the status-specific response schema and returns validated JSON', async () => {
    const exact = schema<{ readonly selected: string }>(() => ({
      data: { selected: 'exact' },
      success: true,
    }));
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ selected: 'wire' }, { status: 201 }),
    );
    const descriptor = operation({
      successResponses: [{ body: 'json', schema: exact, status: 201 }],
    });

    const result = await executeOperation(new EsiClientConfiguration({ fetch }), descriptor, {});

    expect(result.data).toStrictEqual({ selected: 'exact' });
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
    expect(result.data).toStrictEqual({ value: 'unvalidated' });
    expect(responseSchema.safeParse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['declared 200 no-content', 200, [{ body: 'none', status: 200 }] as const],
    ['actual 204', 204, [{ body: 'json', schema: passthroughSchema, status: 204 }] as const],
    ['actual 205', 205, [{ body: 'json', schema: passthroughSchema, status: 205 }] as const],
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
    const descriptor = operation({ successResponses: [{ body: 'none', status: 200 }] });

    await executeOperation(new EsiClientConfiguration({ fetch }), descriptor, {});

    expect(cancelled).toBe(true);
  });

  it('rejects cancellation during the fetched-response handoff with response metadata and body cleanup', async () => {
    const controller = new AbortController();
    const cancel = vi.fn<() => void>();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'x-request-id': 'handoff' },
    });
    const headers = response.headers;
    Object.defineProperty(response, 'headers', {
      get() {
        queueMicrotask(() => controller.abort());
        return headers;
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);

    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch }),
        operation(),
        {},
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      phase: 'response',
      reason: 'network',
      status: 200,
      metadata: { requestId: 'handoff' },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([204, 205])('rejects cancellation during bodyless %s completion', async (status) => {
    const controller = new AbortController();
    const response = new Response(null, { status, headers: { 'x-request-id': 'no-body' } });
    Object.defineProperty(response, 'body', {
      get() {
        queueMicrotask(() => controller.abort());
        return null;
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);

    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch }),
        operation(),
        {},
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      phase: 'response',
      reason: 'network',
      status,
      metadata: { requestId: 'no-body' },
    });
  });

  it('rejects cancellation during declared no-content body cleanup', async () => {
    const controller = new AbortController();
    const cancel = vi.fn<() => void>(() => {
      queueMicrotask(() => controller.abort());
    });
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(body, { headers: { 'x-request-id': 'declared-empty' } }),
    );

    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch }),
        operation({ successResponses: [{ body: 'none', status: 200 }] }),
        {},
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      phase: 'response',
      reason: 'network',
      status: 200,
      metadata: { requestId: 'declared-empty' },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('checks cancellation after consuming JSON before returning success', async () => {
    const controller = new AbortController();
    const responseSchema = schema(() => {
      controller.abort();
      return { success: true, data: { id: 7 } };
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ id: 7 }, { headers: { 'x-request-id': 'parsed' } }),
    );

    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch }),
        operation({ responseSchema }),
        {},
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      phase: 'response',
      reason: 'network',
      status: 200,
      metadata: { requestId: 'parsed' },
    });
    expect(responseSchema.safeParse).toHaveBeenCalledWith({ id: 7 });
  });

  it('rejects a microtask abort after the final JSON chunk is read', async () => {
    const controller = new AbortController();
    let completed = false;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"id":7}'));
        stream.close();
        completed = true;
      },
    });
    const getReader = body.getReader.bind(body);
    Object.defineProperty(body, 'getReader', {
      value: () => {
        const reader = getReader();
        const releaseLock = reader.releaseLock.bind(reader);
        Object.defineProperty(reader, 'releaseLock', {
          value: () => {
            queueMicrotask(() => controller.abort());
            releaseLock();
          },
        });
        return reader;
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(body, { headers: { 'x-request-id': 'complete-json' } }),
    );

    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch }),
        operation(),
        {},
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      phase: 'response',
      reason: 'network',
      status: 200,
      metadata: { requestId: 'complete-json' },
    });
    expect(completed).toBe(true);
  });

  it.each([204, 205, 200])('returns a non-cancelled no-content %s response', async (status) => {
    const descriptor = operation({ successResponses: [{ body: 'none', status }] });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
    const controller = new AbortController();

    await expect(
      executeOperation(
        new EsiClientConfiguration({ fetch }),
        descriptor,
        {},
        {
          signal: controller.signal,
        },
      ),
    ).resolves.toMatchObject({ data: undefined, meta: { status } });
  });
});

describe('transport and response failures', () => {
  it('throws a structured parse error for a successful non-JSON body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response('not JSON', { headers: { 'x-request-id': 'parse-request' }, status: 200 }),
    );

    const promise = executeOperation(new EsiClientConfiguration({ fetch }), operation(), {});

    await expect(promise).rejects.toBeInstanceOf(EsiResponseParseError);
    await expect(promise).rejects.toMatchObject({
      code: 'ESI_RESPONSE_PARSE_ERROR',
      metadata: { headers: { 'x-request-id': 'parse-request' } },
      status: 200,
    });
  });

  it('returns a timeout transport error when fetch ignores cancellation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      phase: 'request',
      reason: 'timeout',
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
      cause: failure,
      code: 'ESI_TRANSPORT_ERROR',
      phase: 'request',
      reason: 'network',
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
    ).rejects.toMatchObject({ phase: 'request', reason: 'timeout' });
    expect(observedSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('composes caller cancellation with the SDK deadline', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const promise = executeOperation(
      new EsiClientConfiguration({ fetch, requestTimeoutMs: 1000 }),
      operation(),
      {},
      { signal: controller.signal },
    );

    controller.abort(new Error('caller cancelled'));

    await expect(promise).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      phase: 'request',
      reason: 'network',
    });
  });

  it('cancels an active response reader on caller abort', async () => {
    const controller = new AbortController();
    const cancel = vi.fn<() => void>();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(body, { headers: { 'x-request-id': 'body-abort' } }),
    );
    const promise = executeOperation(
      new EsiClientConfiguration({ fetch }),
      operation(),
      {},
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      phase: 'response',
      reason: 'network',
      status: 200,
      metadata: { requestId: 'body-abort' },
    });
    expect(cancel).toHaveBeenCalledOnce();
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
      phase: 'response',
      reason: 'network',
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
    ).rejects.toMatchObject({ phase: 'response', reason: 'timeout', status: 200 });
  });

  it('handles a rejected reader cancellation after a response timeout', async () => {
    const cancel = vi.fn<() => Promise<void>>(async () => {
      throw new Error('stream cancellation failed');
    });
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull: () => new Promise(() => undefined),
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 200 }));

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({ phase: 'response', reason: 'timeout', status: 200 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('times out while consuming a stalled error response body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 503 }));

    await expect(
      executeOperation(new EsiClientConfiguration({ fetch, requestTimeoutMs: 5 }), operation(), {}),
    ).rejects.toMatchObject({ phase: 'response', reason: 'timeout', status: 503 });
  });

  it('returns a dedicated not-modified outcome with metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { headers: { ETag: 'revision-2' }, status: 304 }),
    );

    const promise = executeOperation(new EsiClientConfiguration({ fetch }), operation(), {});

    await expect(promise).rejects.toBeInstanceOf(EsiNotModifiedError);
    await expect(promise).rejects.toMatchObject({
      code: 'ESI_NOT_MODIFIED',
      metadata: { cache: { etag: 'revision-2' } },
      status: 304,
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
        new Response(JSON.stringify({ detail: 'x'.repeat(30_000), error: `Bearer ${secret}` }), {
          headers: { 'x-request-id': 'http-request' },
          status: 403,
        }),
    );

    let thrown: unknown;
    try {
      await executeOperation(
        new EsiClientConfiguration({ fetch, token: secret }),
        authenticatedOperation(),
        {},
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EsiHttpError);
    expect(thrown).toMatchObject({ bodyTruncated: true, status: 403 });
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
          fetch: async () =>
            Response.json({ value: 'bad' }, { headers: { 'cache-control': 'public, max-age=30' } }),
          token: secret,
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
      issues: [{ code: 'invalid_[REDACTED]', path: ['body', '[REDACTED]'] }],
      metadata: { cache: { maxAgeSeconds: 30 } },
    });
  });
});

const passthroughSchema: OperationSchema = {
  safeParse: (value: unknown) => ({ data: value, success: true }),
};

function operation<TArguments extends OperationRequestArguments = OperationRequestArguments>(
  overrides: Partial<OperationExecutionDescriptor<TArguments>> & {
    readonly responseSchema?: OperationSchema;
  } = {},
): OperationExecutionDescriptor<TArguments> {
  const { responseSchema = passthroughSchema, ...descriptorOverrides } = overrides;
  return {
    authentication: null,
    method: 'GET',
    operationId: 'get_items',
    parameters: [],
    path: '/items',
    protocol: {
      cache: { extensions: {}, responseHeaders: [] },
      conditionalRequestValidators: [],
      maximumBatchSize: null,
      rateLimit: { kind: 'legacy-only' },
      requestArrayLimits: [],
    },
    requestBody: null,
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
    error: {
      issues: [
        {
          path: ['body', secret],
          message: `Invalid value ${secret}`,
          code: `invalid_${secret}`,
        },
      ],
    },
    success: false,
  }));
}

function jsonFetch(data: unknown): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async () => Response.json(data));
}

function onlyFetchCall(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
): [string | URL | Request, RequestInit | undefined] {
  const call = fetch.mock.calls[0];
  if (call === undefined) {
    throw new Error('Expected fetch to be called');
  }
  return [call[0], call[1]];
}
