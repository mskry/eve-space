import type { EsiClientConfiguration } from './configuration.js';
import { isAbortSignal } from './abort-signal.js';
import {
  ESI_ERROR_BODY_LIMITS,
  EsiAuthenticationRequiredError,
  EsiHttpError,
  EsiNotModifiedError,
  EsiRequestValidationError,
  EsiResponseParseError,
  EsiResponseValidationError,
  EsiTransportError,
} from './errors.js';
import { constructOperationRequest } from './request.js';
import { isRecord } from './request/guards.js';
import { createEsiResponse, extractEsiResponseMetadata } from './response.js';
import type {
  ExecutableOperationDescriptor,
  OperationRequestArguments,
  OperationSchema,
} from './request.js';
import type { EsiResponse, EsiResponseMetadata } from './response.js';

export type OperationSuccessStatus = number | '2XX';

export interface JsonOperationSuccessResponse<TResponse = unknown> {
  readonly status: OperationSuccessStatus;
  readonly body: 'json';
  readonly schema: OperationSchema<TResponse>;
}

export interface NoContentOperationSuccessResponse {
  readonly status: OperationSuccessStatus;
  readonly body: 'none';
}

export type OperationSuccessResponse<TResponse = unknown> =
  | JsonOperationSuccessResponse<TResponse>
  | NoContentOperationSuccessResponse;

export interface OperationAuthentication {
  readonly scopes: readonly string[];
}

export interface OperationTransportDescriptor {
  readonly compatibilityDateOverride?: true;
}

export interface OperationProtocolDescriptor {
  readonly cache: {
    readonly responseHeaders: readonly string[];
    readonly extensions: {
      readonly 'x-cache-age'?: number;
      readonly 'x-cache-mode'?: 'event-based' | 'not-cached' | 'ttl-based';
      readonly 'x-client-cache-ttl'?: number;
      readonly 'x-server-cache-mode'?: 'event-based' | 'not-cached' | 'ttl-based';
      readonly 'x-server-cache-ttl'?: number;
      readonly 'x-tombstone-ttl'?: number;
    };
  };
  readonly conditionalRequestValidators: readonly ('if-modified-since' | 'if-none-match')[];
  readonly rateLimit:
    | { readonly kind: 'legacy-only' }
    | {
        readonly kind: 'declared';
        readonly group: string;
        readonly maximumTokens: number;
        readonly window: string;
      };
  readonly requestArrayLimits: readonly {
    readonly location: 'body' | 'path' | 'query' | 'header' | 'cookie';
    readonly path: readonly string[];
    readonly maximumItems: number;
  }[];
  readonly maximumBatchSize: number | null;
}

export interface OperationExecutionDescriptor<
  TArguments extends OperationRequestArguments = OperationRequestArguments,
  TResponse = unknown,
> extends ExecutableOperationDescriptor<TArguments> {
  readonly authentication: OperationAuthentication | null;
  readonly protocol: OperationProtocolDescriptor;
  readonly successResponses: readonly OperationSuccessResponse<TResponse>[];
  readonly transport?: OperationTransportDescriptor;
}

export interface OperationExecutionOptions {
  readonly forceRequestValidation?: boolean;
  readonly compatibilityDate?: string;
  readonly signal?: AbortSignal;
}

interface ValidatedExecutionDescriptor<TResponse> {
  readonly authentication: OperationAuthentication | null;
  readonly successResponses: readonly OperationSuccessResponse<TResponse>[];
  readonly allowsCompatibilityDateOverride: boolean;
}

const compatibilityDatePattern: RegExp = /^\d{4}-\d{2}-\d{2}$/u;

export async function executeOperation<TArguments extends OperationRequestArguments, TResponse>(
  configuration: EsiClientConfiguration,
  descriptor: OperationExecutionDescriptor<TArguments, TResponse>,
  arguments_: TArguments,
  options: OperationExecutionOptions = {},
): Promise<EsiResponse<TResponse>> {
  const execution = validateExecutionDescriptor(descriptor);
  const forceRequestValidation = validateExecutionOptions(
    descriptor.operationId,
    options,
    execution,
  );
  const validatedArguments =
    configuration.validateRequests || forceRequestValidation
      ? validateOperationRequestArguments(descriptor, arguments_)
      : arguments_;
  const request = constructOperationRequest(descriptor, validatedArguments);
  const compatibilityDate = resolveCompatibilityDate(
    descriptor.operationId,
    configuration.compatibilityDate,
    options.compatibilityDate,
  );
  const headers = createRequestHeaders(
    request.headers,
    request.body,
    compatibilityDate,
    configuration.language,
  );

  const secrets = await authorizeOperationRequest(
    configuration,
    descriptor.operationId,
    execution.authentication,
    options.signal,
    headers,
  );
  const redaction = { secrets };
  const exchange = createExchangeDeadline(configuration.requestTimeoutMs, options.signal);
  try {
    const response = await fetchOperationResponse(
      configuration,
      request,
      headers,
      exchange,
      descriptor.operationId,
      redaction,
    );
    const metadata = extractEsiResponseMetadata(response.status, new Headers(response.headers));
    const responseTransport: EsiOperationResponseContext = {
      metadata,
      operationId: descriptor.operationId,
      phase: 'response',
      redaction,
      status: response.status,
    };
    rejectCancelledResponse(response, exchange, responseTransport);

    await rejectUnsuccessfulResponse(response, exchange, responseTransport);
    rejectCancelledResponse(response, exchange, responseTransport);

    const successResponse = selectSuccessResponse(execution.successResponses, response.status);
    if (response.status === 204 || response.status === 205 || successResponse?.body === 'none') {
      await cancelResponseBody(response, exchange, responseTransport);
      exchange.throwIfCancelled(responseTransport);
      return createEsiResponse(
        // Generated descriptors include undefined in TResponse exactly when no content is declared.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        undefined as TResponse,
        metadata,
      );
    }

    const responseBodyText = await readResponseBody(response, exchange, responseTransport);
    exchange.throwIfCancelled(responseTransport);
    const data = parseResponseBody(responseBodyText, responseTransport);
    const validatedData = validateResponseData(
      data,
      configuration.validateResponses,
      successResponse,
      responseTransport,
    );
    exchange.throwIfCancelled(responseTransport);
    return createEsiResponse(validatedData, metadata);
  } finally {
    exchange.close();
  }
}

async function authorizeOperationRequest(
  configuration: EsiClientConfiguration,
  operationId: string,
  authentication: OperationAuthentication | null,
  signal: AbortSignal | undefined,
  headers: Headers,
): Promise<string[]> {
  throwIfCallerCancelled(signal, operationId);
  if (authentication === null) {
    return [];
  }
  const token = await raceCallerCancellation(
    resolveAccessToken(configuration, operationId, authentication, signal),
    signal,
    operationId,
  );
  throwIfCallerCancelled(signal, operationId);
  headers.set('authorization', `Bearer ${token}`);
  return [token];
}

async function fetchOperationResponse(
  configuration: EsiClientConfiguration,
  request: ReturnType<typeof constructOperationRequest>,
  headers: Headers,
  exchange: EsiExchangeDeadline,
  operationId: string,
  redaction: EsiResponseTransportContext['redaction'],
): Promise<Response> {
  const fetchImplementation = configuration.fetch;
  exchange.throwIfCancelled({ operationId, phase: 'request', redaction });
  const fetchPromise = Promise.resolve().then(() => {
    exchange.throwIfCancelled({ operationId, phase: 'request', redaction });
    return fetchImplementation(`${configuration.baseUrl}${request.path}`, {
      headers,
      method: request.method,
      signal: exchange.signal,
      ...requestBodyInit(request.body),
    });
  });
  void fetchPromise.then(
    (lateResponse) => cancelLateResponse(lateResponse, exchange),
    () => {},
  );
  try {
    return await exchange.race(fetchPromise, { operationId, phase: 'request', redaction });
  } catch (cause) {
    throw networkTransportError(cause, { operationId, phase: 'request', redaction });
  }
}

function requestBodyInit(body: string | undefined): { readonly body?: string } {
  return body === undefined ? {} : { body };
}

function cancelLateResponse(response: Response, exchange: EsiExchangeDeadline): void {
  if (!exchange.cancelled) {
    return;
  }
  void response.body?.cancel().catch(() => {});
}

function rejectCancelledResponse(
  response: Response,
  exchange: EsiExchangeDeadline,
  context: EsiOperationResponseContext,
): void {
  if (exchange.cancelled) {
    void response.body?.cancel().catch(() => {});
    exchange.throwIfCancelled(context);
  }
}

async function rejectUnsuccessfulResponse(
  response: Response,
  exchange: EsiExchangeDeadline,
  context: EsiOperationResponseContext,
): Promise<void> {
  if (response.status === 304) {
    await cancelResponseBody(response, exchange, context);
    exchange.throwIfCancelled(context);
    throw new EsiNotModifiedError(context);
  }
  if (response.ok) {
    return;
  }
  const responseBodyText = await readResponseBody(
    response,
    exchange,
    context,
    ESI_ERROR_BODY_LIMITS.bytes + 1,
  );
  exchange.throwIfCancelled(context);
  throw new EsiHttpError({ ...context, responseBodyText });
}

function parseResponseBody(
  responseBodyText: string | undefined,
  context: EsiOperationResponseContext,
): unknown {
  try {
    return JSON.parse(responseBodyText ?? '');
  } catch (cause) {
    throw new EsiResponseParseError({ ...context, cause });
  }
}

function validateResponseData<TResponse>(
  data: unknown,
  validateResponses: boolean,
  successResponse: JsonOperationSuccessResponse<TResponse> | undefined,
  context: EsiOperationResponseContext,
): TResponse {
  if (!validateResponses) {
    // Validation is explicitly disabled, so the wire value retains the generated response type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return data as TResponse;
  }
  if (successResponse === undefined) {
    throw new EsiResponseValidationError({
      ...context,
      issues: [
        {
          code: 'unsupported_status',
          message: `No response schema is declared for successful HTTP status ${context.status}`,
          path: [],
        },
      ],
    });
  }
  const parsed = successResponse.schema.safeParse(data);
  if (!parsed.success) {
    throw new EsiResponseValidationError({ ...context, issues: parsed.error.issues });
  }
  return parsed.data;
}

function validateExecutionDescriptor<TResponse>(
  descriptor: OperationExecutionDescriptor<OperationRequestArguments, TResponse>,
): ValidatedExecutionDescriptor<TResponse> {
  const operationId = descriptor.operationId;
  const authentication = descriptor.authentication;
  validateAuthentication(operationId, authentication);
  if (!Array.isArray(descriptor.successResponses) || descriptor.successResponses.length === 0) {
    throw new TypeError(`Operation descriptor ${operationId} must declare successful responses`);
  }
  const statuses = validateSuccessResponses(operationId, descriptor.successResponses);
  if (statuses.has('2XX') && statuses.size > 1) {
    throw new TypeError(`Operation descriptor ${operationId} has overlapping success statuses`);
  }
  const transport = descriptor.transport;
  validateTransport(operationId, transport);
  return {
    allowsCompatibilityDateOverride: transport?.compatibilityDateOverride === true,
    authentication,
    successResponses: descriptor.successResponses,
  };
}

function validateAuthentication(
  operationId: string,
  authentication: OperationAuthentication | null,
): void {
  if (authentication === null) {
    return;
  }
  if (!isRecord(authentication) || !Array.isArray(authentication.scopes)) {
    throw new TypeError(`Operation descriptor ${operationId} authentication must provide scopes`);
  }
  for (const scope of authentication.scopes) {
    if (typeof scope !== 'string' || scope.length === 0) {
      throw new TypeError(
        `Operation descriptor ${operationId} has an invalid authentication scope`,
      );
    }
  }
}

function validateSuccessResponses(
  operationId: string,
  responses: readonly OperationSuccessResponse[],
): Set<OperationSuccessStatus> {
  const statuses = new Set<OperationSuccessStatus>();
  for (const response of responses) {
    validateSuccessResponse(operationId, response);
    if (statuses.has(response.status)) {
      throw new TypeError(
        `Operation descriptor ${operationId} has duplicate success status ${response.status}`,
      );
    }
    statuses.add(response.status);
  }
  return statuses;
}

function validateTransport(
  operationId: string,
  transport: OperationTransportDescriptor | undefined,
): void {
  if (
    transport !== undefined &&
    (!isRecord(transport) ||
      (transport.compatibilityDateOverride !== undefined &&
        transport.compatibilityDateOverride !== true))
  ) {
    throw new TypeError(`Operation descriptor ${operationId} has invalid transport metadata`);
  }
}

function validateSuccessResponse(operationId: string, response: OperationSuccessResponse): void {
  if (!isRecord(response)) {
    throw new TypeError(`Operation descriptor ${operationId} has an invalid success response`);
  }
  if (
    response.status !== '2XX' &&
    (!Number.isInteger(response.status) || response.status < 200 || response.status > 299)
  ) {
    throw new TypeError(`Operation descriptor ${operationId} has an invalid success status`);
  }
  if (response.body !== 'json' && response.body !== 'none') {
    throw new TypeError(`Operation descriptor ${operationId} has an invalid success response body`);
  }
  if (
    response.body === 'json' &&
    (!isRecord(response.schema) || typeof response.schema.safeParse !== 'function')
  ) {
    throw new TypeError(
      `Operation descriptor ${operationId} JSON response schema must provide safeParse()`,
    );
  }
  if (response.body === 'none' && 'schema' in response) {
    throw new TypeError(`Operation descriptor ${operationId} no-content response has a schema`);
  }
}

function validateExecutionOptions<TResponse>(
  operationId: string,
  options: OperationExecutionOptions,
  descriptor: ValidatedExecutionDescriptor<TResponse>,
): boolean {
  if (!isRecord(options)) {
    throw requestValidationError(
      operationId,
      [],
      'Execution options must be an object',
      'invalid_type',
    );
  }
  for (const key of Object.keys(options)) {
    if (key !== 'forceRequestValidation' && key !== 'compatibilityDate' && key !== 'signal') {
      throw requestValidationError(
        operationId,
        [key],
        `Unknown execution option: ${key}`,
        'unrecognized_key',
      );
    }
  }
  if (
    options.forceRequestValidation !== undefined &&
    typeof options.forceRequestValidation !== 'boolean'
  ) {
    throw requestValidationError(
      operationId,
      ['forceRequestValidation'],
      'forceRequestValidation must be a boolean',
      'invalid_type',
    );
  }
  if (options.compatibilityDate !== undefined && !descriptor.allowsCompatibilityDateOverride) {
    throw requestValidationError(
      operationId,
      ['compatibilityDate'],
      'This operation does not declare a compatibility-date override',
      'unrecognized_key',
    );
  }
  if (options.signal !== undefined && !isAbortSignal(options.signal)) {
    throw requestValidationError(
      operationId,
      ['signal'],
      'signal must be an AbortSignal',
      'invalid_type',
    );
  }
  return options.forceRequestValidation ?? false;
}

export function validateOperationRequestArguments<TArguments extends OperationRequestArguments>(
  descriptor: OperationExecutionDescriptor<TArguments>,
  arguments_: TArguments,
): TArguments {
  if (descriptor.requestSchema === undefined) {
    throw new TypeError(
      `Operation descriptor ${descriptor.operationId} requires a request schema for validation`,
    );
  }
  const parsed = descriptor.requestSchema.safeParse(arguments_);
  if (!parsed.success) {
    throw new EsiRequestValidationError({
      issues: parsed.error.issues,
      operationId: descriptor.operationId,
    });
  }
  return parsed.data;
}

function resolveCompatibilityDate(
  operationId: string,
  configured: string,
  override: string | undefined,
): string {
  const value = override ?? configured;
  if (typeof value !== 'string' || !compatibilityDatePattern.test(value)) {
    throw requestValidationError(
      operationId,
      ['compatibilityDate'],
      'compatibilityDate must use the YYYY-MM-DD format',
      'invalid_format',
    );
  }
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== value) {
    throw requestValidationError(
      operationId,
      ['compatibilityDate'],
      'compatibilityDate must be a valid calendar date',
      'invalid_format',
    );
  }
  return value;
}

function createRequestHeaders(
  operationHeaders: Readonly<Record<string, string>>,
  body: string | undefined,
  compatibilityDate: string,
  language: string,
): Headers {
  const headers = new Headers(operationHeaders);
  headers.set('accept', 'application/json');
  headers.set('accept-language', language);
  headers.set('x-compatibility-date', compatibilityDate);
  headers.delete('authorization');
  if (body === undefined) {
    headers.delete('content-type');
  } else {
    headers.set('content-type', 'application/json');
  }
  return headers;
}

async function resolveAccessToken(
  configuration: EsiClientConfiguration,
  operationId: string,
  authentication: OperationAuthentication,
  signal: AbortSignal | undefined,
): Promise<string> {
  let token = configuration.token;
  if (token === undefined && configuration.tokenProvider !== undefined) {
    try {
      throwIfCallerCancelled(signal, operationId);
      token = await configuration.tokenProvider({ signal });
    } catch (cause) {
      throwIfCallerCancelled(signal, operationId);
      throw new EsiAuthenticationRequiredError({
        cause,
        operationId,
        scopes: authentication.scopes,
      });
    }
  }
  throwIfCallerCancelled(signal, operationId);
  if (!isSafeToken(token)) {
    throw new EsiAuthenticationRequiredError({
      operationId,
      scopes: authentication.scopes,
      ...(typeof token === 'string' && { redaction: { secrets: [token] } }),
    });
  }
  return token;
}

function isSafeToken(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) {
      return false;
    }
  }
  return true;
}

async function raceCallerCancellation<Value>(
  promise: PromiseLike<Value>,
  signal: AbortSignal | undefined,
  operationId: string,
): Promise<Value> {
  if (signal === undefined) {
    return await promise;
  }
  let rejectCancellation: ((reason: EsiTransportError) => void) | undefined;
  const cancellationPromise = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  void cancellationPromise.catch(() => {});
  const cancel = () =>
    rejectCancellation?.(
      new EsiTransportError({
        cause: signal.reason,
        operationId,
        phase: 'request',
        reason: 'network',
      }),
    );
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) {
    cancel();
  }
  try {
    const value = await Promise.race([promise, cancellationPromise]);
    throwIfCallerCancelled(signal, operationId);
    return value;
  } catch (cause) {
    throwIfCallerCancelled(signal, operationId);
    throw cause;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function throwIfCallerCancelled(signal: AbortSignal | undefined, operationId: string): void {
  if (signal?.aborted) {
    throw new EsiTransportError({
      cause: signal.reason,
      operationId,
      phase: 'request',
      reason: 'network',
    });
  }
}

function selectSuccessResponse<TResponse>(
  responses: readonly OperationSuccessResponse<TResponse>[],
  status: number,
): OperationSuccessResponse<TResponse> | undefined {
  return responses.find((response) => response.status === status || response.status === '2XX');
}

interface EsiResponseTransportContext {
  readonly operationId: string;
  readonly phase: 'request' | 'response';
  readonly status?: number;
  readonly metadata?: EsiResponseMetadata;
  readonly redaction: { readonly secrets: readonly string[] };
}

interface EsiOperationResponseContext extends EsiResponseTransportContext {
  readonly phase: 'response';
  readonly status: number;
  readonly metadata: EsiResponseMetadata;
}

interface EsiExchangeDeadline {
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
  race<Value>(promise: PromiseLike<Value>, context: EsiResponseTransportContext): Promise<Value>;
  throwIfCancelled(context: EsiResponseTransportContext): void;
  close(): void;
}

function createExchangeDeadline(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): EsiExchangeDeadline {
  const timeoutController = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;
  const cancellation = { reason: undefined as 'timeout' | 'network' | undefined };
  let rejectCancellation: ((reason: typeof cancellation) => void) | undefined;
  const cancellationPromise = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  void cancellationPromise.catch(() => {});
  const cancel = (reason: 'timeout' | 'network') => {
    if (cancellation.reason !== undefined) {
      return;
    }
    cancellation.reason = reason;
    rejectCancellation?.(cancellation);
  };
  const onCallerAbort = () => cancel('network');
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  if (callerSignal?.aborted) {
    onCallerAbort();
  }
  const timer = setTimeout(() => {
    cancel('timeout');
    timeoutController.abort(new Error('ESI request timeout'));
  }, timeoutMs);

  return {
    get cancelled() {
      return cancellation.reason !== undefined;
    },
    close() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
    async race<Value>(promise: PromiseLike<Value>, context: EsiResponseTransportContext) {
      try {
        return await Promise.race([promise, cancellationPromise]);
      } catch (cause) {
        if (cause !== cancellation) {
          throw cause;
        }
        throw new EsiTransportError({
          ...context,
          reason: cancellation.reason ?? 'network',
          cause: signal.reason,
        });
      }
    },
    throwIfCancelled(context: EsiResponseTransportContext) {
      if (cancellation.reason !== undefined) {
        throw new EsiTransportError({
          ...context,
          reason: cancellation.reason,
          cause: signal.reason,
        });
      }
    },
    signal,
  };
}

async function cancelResponseBody(
  response: Response,
  exchange: EsiExchangeDeadline,
  context: EsiResponseTransportContext,
): Promise<void> {
  if (response.body === null) {
    return;
  }
  try {
    await exchange.race(response.body.cancel(), context);
  } catch (cause) {
    throw networkTransportError(cause, context);
  }
}

async function readResponseBody(
  response: Response,
  exchange: EsiExchangeDeadline,
  context: EsiResponseTransportContext,
  maximumBytes = Infinity,
): Promise<string | undefined> {
  if (response.body === null) {
    return undefined;
  }
  const reader = response.body.getReader();
  const body = { byteLength: 0, chunks: [] as Uint8Array[] };
  let cancellationStarted = false;
  const cancel = () => {
    cancellationStarted = true;
    cancelResponseReader(reader, exchange.signal.reason);
  };
  exchange.signal.addEventListener('abort', cancel, { once: true });
  if (exchange.signal.aborted) {
    cancel();
  }
  try {
    await readResponseChunks(reader, exchange, context, maximumBytes, body);
  } catch (cause) {
    throw networkTransportError(cause, context);
  } finally {
    exchange.signal.removeEventListener('abort', cancel);
    await finishResponseRead(reader, cancellationStarted, body.byteLength >= maximumBytes);
  }
  return decodeResponseChunks(body);
}

async function readResponseChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  exchange: EsiExchangeDeadline,
  context: EsiResponseTransportContext,
  maximumBytes: number,
  body: { chunks: Uint8Array[]; byteLength: number },
): Promise<void> {
  while (body.byteLength < maximumBytes) {
    const result = await exchange.race(reader.read(), context);
    if (result.done) {
      break;
    }
    const remaining = maximumBytes - body.byteLength;
    body.chunks.push(boundedResponseChunk(result.value, remaining));
    body.byteLength += Math.min(result.value.byteLength, remaining);
    if (result.value.byteLength > remaining) {
      break;
    }
  }
}

function boundedResponseChunk(chunk: Uint8Array, maximumBytes: number): Uint8Array {
  return chunk.byteLength > maximumBytes ? chunk.slice(0, maximumBytes) : chunk;
}

function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  void reader
    .cancel(reason)
    .finally(() => releaseResponseReader(reader))
    .catch(() => {});
}

async function finishResponseRead(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cancellationStarted: boolean,
  reachedMaximumBytes: boolean,
): Promise<void> {
  if (cancellationStarted) {
    return;
  }
  if (reachedMaximumBytes) {
    await reader.cancel().catch(() => {});
  }
  releaseResponseReader(reader);
}

function releaseResponseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    void reader.closed.finally(() => reader.releaseLock()).catch(() => {});
  }
}

function decodeResponseChunks(body: { chunks: Uint8Array[]; byteLength: number }): string {
  const bytes = new Uint8Array(body.byteLength);
  let offset = 0;
  for (const chunk of body.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function networkTransportError(
  cause: unknown,
  context: EsiResponseTransportContext,
): EsiTransportError {
  if (cause instanceof EsiTransportError) {
    return cause;
  }
  return new EsiTransportError({ ...context, cause, reason: 'network' });
}

function requestValidationError(
  operationId: string,
  path: readonly (string | number)[],
  message: string,
  code: string,
): EsiRequestValidationError {
  return new EsiRequestValidationError({ issues: [{ path, message, code }], operationId });
}
