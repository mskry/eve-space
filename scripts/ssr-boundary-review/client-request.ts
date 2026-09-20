const CLIENT_ROOT_PATTERN = /\b(?:apiClient|client)\b/g
const CLIENT_SEGMENT_PATTERN = /\s*(?:\.\s*(\w+)|\[\s*'([^']*)'\s*\])/y
const CLIENT_METHOD_PATTERN = /\s*\.\s*\$(get|post|put|patch|delete)\b/y

export interface ClientRequest {
  readonly method: string
  readonly requestPath: string
}

export const clientRequestIn = (source: string): ClientRequest | null => {
  for (const root of source.matchAll(CLIENT_ROOT_PATTERN)) {
    const request = clientRequestAfter(source, root.index + root[0].length)
    if (request) return request
  }
  return null
}

const clientRequestAfter = (source: string, start: number): ClientRequest | null => {
  const segments: string[] = []
  let offset = start

  while (true) {
    CLIENT_METHOD_PATTERN.lastIndex = offset
    const method = CLIENT_METHOD_PATTERN.exec(source)
    if (method)
      return segments.length > 0
        ? { method: method[1].toUpperCase(), requestPath: `/${segments.join('/')}` }
        : null

    CLIENT_SEGMENT_PATTERN.lastIndex = offset
    const segment = CLIENT_SEGMENT_PATTERN.exec(source)
    if (!segment) return null

    segments.push(segment[1] ?? segment[2])
    offset = CLIENT_SEGMENT_PATTERN.lastIndex
  }
}
