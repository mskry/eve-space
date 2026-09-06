export const ESI_ERROR_BODY_LIMITS: Readonly<{
  bytes: number;
  characters: number;
  depth: number;
  keys: number;
  arrayItems: number;
  stringCharacters: number;
}> = Object.freeze({
  bytes: 16_384,
  characters: 8_192,
  depth: 8,
  keys: 256,
  arrayItems: 100,
  stringCharacters: 1_024,
});

export const REDACTED: string = '[REDACTED]';
export const TRUNCATED: string = '[TRUNCATED]';
export const MAX_OPERATION_ID_CHARACTERS: number = 256;
export const MAX_MESSAGE_CHARACTERS: number = 512;
export const MAX_METADATA_STRING_CHARACTERS: number = 1_024;
export const MAX_HEADER_COUNT: number = 128;
export const MAX_HEADER_NAME_CHARACTERS: number = 256;
export const MAX_ISSUES: number = 100;
export const MAX_ISSUE_PATH_SEGMENTS: number = 32;
export const MAX_ISSUE_STRING_CHARACTERS: number = 256;
export const MAX_SCOPES: number = 64;
export const MAX_SECRET_LOOKAHEAD: number = 4_096;
