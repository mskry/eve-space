import {
  EsiHttpError,
  EsiNotModifiedError,
  EsiResponseParseError,
  EsiResponseValidationError,
  EsiTransportError,
  type EsiResponseMetadata,
} from '@evespace/esi-client'

export function getEsiResponseErrorMetadata(error: unknown): EsiResponseMetadata | undefined {
  if (
    error instanceof EsiHttpError ||
    error instanceof EsiNotModifiedError ||
    error instanceof EsiResponseParseError ||
    error instanceof EsiResponseValidationError ||
    error instanceof EsiTransportError
  )
    return error.metadata
  return undefined
}
