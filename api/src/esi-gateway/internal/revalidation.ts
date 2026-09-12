import type { OperationRequestArguments } from '@evespace/esi-client/operations'
import { isRecord } from '../../type-guards.js'

const reservedHeaders = new Set(['if-none-match', 'if-modified-since'])

export interface EsiConditionalRevalidation {
  readonly ifNoneMatch?: string
  readonly ifModifiedSince?: string
}

export function withEsiRevalidation<Arguments extends OperationRequestArguments>(
  inputs: Arguments,
  revalidation: EsiConditionalRevalidation,
) {
  assertNoCallerEsiRevalidationHeaders(inputs)
  if (!revalidation.ifNoneMatch && !revalidation.ifModifiedSince) return inputs
  const headers = isRecord(inputs.headers) ? inputs.headers : {}
  return {
    ...inputs,
    headers: {
      ...headers,
      ...(revalidation.ifNoneMatch ? { 'If-None-Match': revalidation.ifNoneMatch } : {}),
      ...(revalidation.ifModifiedSince
        ? { 'If-Modified-Since': revalidation.ifModifiedSince }
        : {}),
    },
  }
}

export function assertNoCallerEsiRevalidationHeaders(
  inputs: OperationRequestArguments & { readonly header?: unknown },
) {
  for (const headers of [inputs.header, inputs.headers]) {
    if (!isRecord(headers)) continue
    const reserved = Object.keys(headers).find((name) => reservedHeaders.has(name.toLowerCase()))
    if (reserved) throw new Error(`ESI request header ${reserved} is executor-owned`)
  }
}
