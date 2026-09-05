import type { EsiResponseMetadata, EsiResponseMetadataInput } from '../response.js';

export type EsiErrorCode =
  | 'ESI_UNKNOWN_OPERATION'
  | 'ESI_AUTHENTICATION_REQUIRED'
  | 'ESI_GENERIC_MUTATION_DISABLED'
  | 'ESI_GENERIC_MUTATION_UNCONFIRMED'
  | 'ESI_HTTP_ERROR'
  | 'ESI_RESPONSE_PARSE_ERROR'
  | 'ESI_REQUEST_VALIDATION_ERROR'
  | 'ESI_RESPONSE_VALIDATION_ERROR';

export type EsiValidationDirection = 'request' | 'response';
export type EsiErrorBodyFormat = 'json' | 'text' | 'none';
export type EsiErrorBodyValue =
  | null
  | boolean
  | number
  | string
  | readonly EsiErrorBodyValue[]
  | { readonly [key: string]: EsiErrorBodyValue };

export interface EsiErrorRedactionContext {
  readonly secrets?: readonly string[];
}

export interface EsiValidationIssueInput {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly code?: string;
}

export interface EsiValidationIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly code: string;
}

export interface SerializedEsiError {
  readonly name: string;
  readonly code: EsiErrorCode;
  readonly message: string;
  readonly operationId: string;
}

export interface SerializedEsiAuthenticationRequiredError extends SerializedEsiError {
  readonly scopes: readonly string[];
}

export interface SerializedEsiHttpError extends SerializedEsiError {
  readonly status: number;
  readonly metadata: EsiResponseMetadata;
  readonly bodyFormat: EsiErrorBodyFormat;
  readonly body: EsiErrorBodyValue | undefined;
  readonly bodyTruncated: boolean;
}

export interface SerializedEsiResponseParseError extends SerializedEsiError {
  readonly status: number;
  readonly metadata: EsiResponseMetadata;
}

export interface SerializedEsiValidationError extends SerializedEsiError {
  readonly direction: EsiValidationDirection;
  readonly issues: readonly EsiValidationIssue[];
}

export interface CommonErrorOptions {
  readonly operationId: string;
  readonly message?: string;
  readonly redaction?: EsiErrorRedactionContext;
  readonly cause?: unknown;
}

export interface EsiUnknownOperationErrorOptions extends CommonErrorOptions {}

export interface EsiAuthenticationRequiredErrorOptions extends CommonErrorOptions {
  readonly scopes?: readonly string[];
}

export interface EsiGenericMutationDisabledErrorOptions extends CommonErrorOptions {}

export interface EsiGenericMutationUnconfirmedErrorOptions extends CommonErrorOptions {}

export interface EsiHttpErrorOptions extends CommonErrorOptions {
  readonly status: number;
  readonly metadata?: EsiResponseMetadataInput;
  readonly responseBodyText?: string;
}

export interface EsiResponseParseErrorOptions extends CommonErrorOptions {
  readonly status: number;
  readonly metadata?: EsiResponseMetadataInput;
}

export interface EsiValidationErrorOptions extends CommonErrorOptions {
  readonly issues: readonly EsiValidationIssueInput[];
}

export interface EsiRequestValidationErrorOptions extends EsiValidationErrorOptions {}

export interface EsiResponseValidationErrorOptions extends EsiValidationErrorOptions {}
