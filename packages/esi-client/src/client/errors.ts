export { ESI_ERROR_BODY_LIMITS } from './error/limits.js';
import {
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
} from './error/classes.js';
export {
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
};
export type {
  EsiAuthenticationRequiredErrorOptions,
  EsiErrorBodyFormat,
  EsiErrorBodyValue,
  EsiErrorCode,
  EsiErrorRedactionContext,
  EsiGenericMutationDisabledErrorOptions,
  EsiGenericMutationUnconfirmedErrorOptions,
  EsiHttpErrorOptions,
  EsiNotModifiedErrorOptions,
  EsiRequestValidationErrorOptions,
  EsiResponseParseErrorOptions,
  EsiResponseValidationErrorOptions,
  EsiTransportErrorOptions,
  EsiTransportFailurePhase,
  EsiTransportFailureReason,
  EsiUnknownOperationErrorOptions,
  EsiValidationDirection,
  EsiValidationIssue,
  EsiValidationIssueInput,
  SerializedEsiAuthenticationRequiredError,
  SerializedEsiError,
  SerializedEsiHttpError,
  SerializedEsiNotModifiedError,
  SerializedEsiResponseParseError,
  SerializedEsiResponseValidationError,
  SerializedEsiTransportError,
  SerializedEsiValidationError,
} from './error/types.js';

export type EsiFailureClassification =
  | 'transient'
  | 'throttled'
  | 'not-modified'
  | 'invalid-response'
  | 'permanent'
  | 'unknown';

export function classifyEsiFailure(error: unknown): EsiFailureClassification {
  if (error instanceof EsiTransportError) return 'transient';
  if (error instanceof EsiNotModifiedError) return 'not-modified';
  if (error instanceof EsiResponseParseError || error instanceof EsiResponseValidationError)
    return 'invalid-response';
  if (error instanceof EsiHttpError) {
    if (error.status === 429) return 'throttled';
    return error.status >= 500 && error.status < 600 ? 'transient' : 'permanent';
  }
  return error instanceof EsiError ? 'permanent' : 'unknown';
}
