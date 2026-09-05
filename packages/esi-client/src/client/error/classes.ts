import type { EsiResponseMetadata } from '../response.js';
import { normalizeErrorBody } from './body-sanitizer.js';
import { MAX_MESSAGE_CHARACTERS, MAX_OPERATION_ID_CHARACTERS } from './limits.js';
import {
  normalizeIssues,
  normalizeMetadata,
  normalizeScopes,
  normalizeStatus,
} from './metadata-sanitizer.js';
import type { Redactor } from './redaction.js';
import { createRedactor, sanitizeString } from './redaction.js';
import type {
  CommonErrorOptions,
  EsiAuthenticationRequiredErrorOptions,
  EsiErrorBodyFormat,
  EsiErrorBodyValue,
  EsiErrorCode,
  EsiGenericMutationDisabledErrorOptions,
  EsiGenericMutationUnconfirmedErrorOptions,
  EsiHttpErrorOptions,
  EsiRequestValidationErrorOptions,
  EsiResponseParseErrorOptions,
  EsiResponseValidationErrorOptions,
  EsiUnknownOperationErrorOptions,
  EsiValidationDirection,
  EsiValidationErrorOptions,
  EsiValidationIssue,
  SerializedEsiAuthenticationRequiredError,
  SerializedEsiError,
  SerializedEsiHttpError,
  SerializedEsiResponseParseError,
  SerializedEsiValidationError,
} from './types.js';

export class EsiError extends Error {
  readonly code: EsiErrorCode;
  readonly operationId: string;

  protected constructor(
    name: string,
    code: EsiErrorCode,
    defaultMessage: string,
    options: CommonErrorOptions,
    redactor: Redactor,
  ) {
    const operationId = sanitizeString(
      options.operationId,
      redactor,
      MAX_OPERATION_ID_CHARACTERS,
      'unknown',
    );
    const message = sanitizeString(
      options.message,
      redactor,
      MAX_MESSAGE_CHARACTERS,
      defaultMessage.replace('{operationId}', operationId),
    );
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    Object.defineProperty(this, 'name', { value: name, enumerable: false });
    this.code = code;
    this.operationId = operationId;
  }

  toJSON(): SerializedEsiError {
    return Object.freeze({
      name: this.name,
      code: this.code,
      message: this.message,
      operationId: this.operationId,
    });
  }
}

export class EsiUnknownOperationError extends EsiError {
  constructor(options: EsiUnknownOperationErrorOptions) {
    const redactor = createRedactor(options.redaction);
    super(
      'EsiUnknownOperationError',
      'ESI_UNKNOWN_OPERATION',
      'Unknown ESI operation: {operationId}',
      options,
      redactor,
    );
    Object.freeze(this);
  }
}

export class EsiAuthenticationRequiredError extends EsiError {
  readonly scopes: readonly string[];

  constructor(options: EsiAuthenticationRequiredErrorOptions) {
    const redactor = createRedactor(options.redaction);
    super(
      'EsiAuthenticationRequiredError',
      'ESI_AUTHENTICATION_REQUIRED',
      'Authentication is required for ESI operation {operationId}',
      options,
      redactor,
    );
    this.scopes = normalizeScopes(options.scopes, redactor);
    Object.freeze(this);
  }

  override toJSON(): SerializedEsiAuthenticationRequiredError {
    return Object.freeze({ ...super.toJSON(), scopes: this.scopes });
  }
}

export class EsiGenericMutationDisabledError extends EsiError {
  constructor(options: EsiGenericMutationDisabledErrorOptions) {
    const redactor = createRedactor(options.redaction);
    super(
      'EsiGenericMutationDisabledError',
      'ESI_GENERIC_MUTATION_DISABLED',
      'Generic mutations are disabled for ESI operation {operationId}',
      options,
      redactor,
    );
    Object.freeze(this);
  }
}

export class EsiGenericMutationUnconfirmedError extends EsiError {
  constructor(options: EsiGenericMutationUnconfirmedErrorOptions) {
    const redactor = createRedactor(options.redaction);
    super(
      'EsiGenericMutationUnconfirmedError',
      'ESI_GENERIC_MUTATION_UNCONFIRMED',
      'Generic mutation confirmation is required for ESI operation {operationId}',
      options,
      redactor,
    );
    Object.freeze(this);
  }
}

export class EsiHttpError extends EsiError {
  readonly status: number;
  readonly metadata: EsiResponseMetadata;
  readonly bodyFormat: EsiErrorBodyFormat;
  readonly body: EsiErrorBodyValue | undefined;
  readonly bodyTruncated: boolean;

  constructor(options: EsiHttpErrorOptions) {
    const redactor = createRedactor(options.redaction);
    const status = normalizeStatus(options.status);
    super(
      'EsiHttpError',
      'ESI_HTTP_ERROR',
      `ESI operation {operationId} failed with HTTP status ${status}`,
      options,
      redactor,
    );
    const body = normalizeErrorBody(options.responseBodyText, redactor);
    this.status = status;
    this.metadata = normalizeMetadata(status, options.metadata, redactor);
    this.bodyFormat = body?.format ?? 'none';
    this.body = body?.value;
    this.bodyTruncated = body?.truncated ?? false;
    Object.freeze(this);
  }

  override toJSON(): SerializedEsiHttpError {
    return Object.freeze({
      ...super.toJSON(),
      status: this.status,
      metadata: this.metadata,
      bodyFormat: this.bodyFormat,
      body: this.body,
      bodyTruncated: this.bodyTruncated,
    });
  }
}

export class EsiResponseParseError extends EsiError {
  readonly status: number;
  readonly metadata: EsiResponseMetadata;

  constructor(options: EsiResponseParseErrorOptions) {
    const redactor = createRedactor(options.redaction);
    const status = normalizeStatus(options.status);
    super(
      'EsiResponseParseError',
      'ESI_RESPONSE_PARSE_ERROR',
      'Failed to parse the response for ESI operation {operationId}',
      options,
      redactor,
    );
    this.status = status;
    this.metadata = normalizeMetadata(status, options.metadata, redactor);
    Object.freeze(this);
  }

  override toJSON(): SerializedEsiResponseParseError {
    return Object.freeze({
      ...super.toJSON(),
      status: this.status,
      metadata: this.metadata,
    });
  }
}

export class EsiValidationError extends EsiError {
  readonly direction: EsiValidationDirection;
  readonly issues: readonly EsiValidationIssue[];

  protected constructor(
    name: string,
    code: 'ESI_REQUEST_VALIDATION_ERROR' | 'ESI_RESPONSE_VALIDATION_ERROR',
    direction: EsiValidationDirection,
    options: EsiValidationErrorOptions,
    redactor: Redactor,
  ) {
    super(
      name,
      code,
      `ESI ${direction} validation failed for operation {operationId}`,
      options,
      redactor,
    );
    this.direction = direction;
    this.issues = normalizeIssues(options.issues, redactor);
  }

  override toJSON(): SerializedEsiValidationError {
    return Object.freeze({
      ...super.toJSON(),
      direction: this.direction,
      issues: this.issues,
    });
  }
}

export class EsiRequestValidationError extends EsiValidationError {
  constructor(options: EsiRequestValidationErrorOptions) {
    const redactor = createRedactor(options.redaction);
    super(
      'EsiRequestValidationError',
      'ESI_REQUEST_VALIDATION_ERROR',
      'request',
      options,
      redactor,
    );
    Object.freeze(this);
  }
}

export class EsiResponseValidationError extends EsiValidationError {
  constructor(options: EsiResponseValidationErrorOptions) {
    const redactor = createRedactor(options.redaction);
    super(
      'EsiResponseValidationError',
      'ESI_RESPONSE_VALIDATION_ERROR',
      'response',
      options,
      redactor,
    );
    Object.freeze(this);
  }
}
