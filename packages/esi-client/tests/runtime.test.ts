import { describe, expect, it, vi } from 'vitest';

import { EsiClient, EsiHttpError, EsiNotModifiedError, createStatusClient } from '../src/index';
import * as sdk from '../src/index';
import { zGetStatusResponse } from '../src/generated/zod.gen.js';

describe('root client surface', () => {
  it('exports generated client and domain behavior', async () => {
    const fetchApi = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            players: 42,
            server_version: 'test',
            start_time: '2026-08-18T00:00:00Z',
            vip: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new EsiClient({ baseUrl: 'https://example.test', fetch: fetchApi });
    const standalone = createStatusClient({
      baseUrl: 'https://example.test',
      fetch: fetchApi,
    });

    expect(client.status).toEqual(expect.objectContaining({ get: expect.any(Function) }));
    expect(standalone).toEqual(expect.objectContaining({ get: expect.any(Function) }));
    const status = await client.status.get({ compatibilityDate: '2020-01-01' });

    expect(fetchApi).toHaveBeenCalledOnce();
    const [url, init] = fetchApi.mock.calls[0];
    expect(url).toBe('https://example.test/status');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('x-compatibility-date')).toBe('2020-01-01');
    expect(status).toEqual({
      players: 42,
      server_version: 'test',
      start_time: '2026-08-18T00:00:00Z',
      vip: false,
    });
    expect(zGetStatusResponse.parse(status)).toEqual(status);
  });

  it('exports structured HTTP errors without prototype exports', async () => {
    const client = new EsiClient({
      baseUrl: 'https://example.test',
      fetch: async () => new Response('unavailable', { status: 503 }),
    });

    const error = await client.status.get().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EsiHttpError);
    if (!(error instanceof EsiHttpError)) throw error;
    expect(error.status).toBe(503);
    expect(error.code).toBe('ESI_HTTP_ERROR');
    expect(sdk).not.toHaveProperty('Configuration');
    expect(sdk).not.toHaveProperty('StatusApi');
  });

  it.each([
    [
      'aggregate',
      (fetchApi: typeof fetch) =>
        new EsiClient({ baseUrl: 'https://example.test', fetch: fetchApi }).status.get({
          ifNoneMatch: 'revision-1',
        }),
    ],
    [
      'standalone',
      (fetchApi: typeof fetch) =>
        createStatusClient({ baseUrl: 'https://example.test', fetch: fetchApi }).get({
          ifNoneMatch: 'revision-1',
        }),
    ],
    [
      'generic',
      (fetchApi: typeof fetch) =>
        new EsiClient({ baseUrl: 'https://example.test', fetch: fetchApi }).callOperation(
          'GetStatus',
          { headers: { 'If-None-Match': 'revision-1' } },
        ),
    ],
  ])('returns a typed 304 outcome through the %s surface', async (_surface, call) => {
    const fetchApi = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 304, headers: { etag: 'revision-1' } }),
    );

    const error = await call(fetchApi).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EsiNotModifiedError);
    expect(error).toMatchObject({ status: 304, metadata: { cache: { etag: 'revision-1' } } });
    expect(fetchApi).toHaveBeenCalledOnce();
    expect(new Headers(fetchApi.mock.calls[0]?.[1]?.headers).get('if-none-match')).toBe(
      'revision-1',
    );
  });

  it.each([
    [
      'aggregate',
      (fetchApi: typeof fetch) =>
        new EsiClient({
          baseUrl: 'https://example.test',
          fetch: fetchApi,
          requestTimeoutMs: 5,
        }).status.get(),
    ],
    [
      'standalone',
      (fetchApi: typeof fetch) =>
        createStatusClient({
          baseUrl: 'https://example.test',
          fetch: fetchApi,
          requestTimeoutMs: 5,
        }).get(),
    ],
    [
      'generic',
      (fetchApi: typeof fetch) =>
        new EsiClient({
          baseUrl: 'https://example.test',
          fetch: fetchApi,
          requestTimeoutMs: 5,
        }).callOperation('GetStatus', {}),
    ],
  ])('applies the configured deadline through the %s surface', async (_surface, call) => {
    const fetchApi = vi.fn<typeof fetch>(() => new Promise(() => undefined));

    await expect(call(fetchApi)).rejects.toMatchObject({
      code: 'ESI_TRANSPORT_ERROR',
      reason: 'timeout',
      phase: 'request',
    });
    expect(fetchApi).toHaveBeenCalledOnce();
  });
});
