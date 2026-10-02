import { GraphQLError, type ExecutionResult } from 'graphql'
import { z } from 'zod'
import { formatGraphQLError } from './errors.js'

const maximumBytes = 2_097_152
const exceeded = () =>
  new GraphQLError('Operation work limit exceeded.', { extensions: { code: 'OPERATION_LIMIT' } })

const boundedStringify = <Value>(value: Value) => {
  let size = 0
  const result = JSON.stringify(value, (key, item: Value) => {
    size += key.length + 4
    const string = z.string().safeParse(item)
    if (string.success) {
      if (string.data.length > maximumBytes) throw exceeded()
      size += Buffer.byteLength(JSON.stringify(string.data))
    }
    if (size > maximumBytes) throw exceeded()
    return item
  })
  if (Buffer.byteLength(result) > maximumBytes) throw exceeded()
  return result
}

export const graphQLResponse = (
  result: ExecutionResult,
  cacheControl: string,
  reportUnexpected: () => void,
) => {
  const executed = 'data' in result
  if (
    !executed &&
    result.errors?.some(
      (error) => z.object({ status: z.literal(413) }).safeParse(error.extensions.http).success,
    )
  )
    return Response.json(
      { message: 'Request is too large.' },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    )
  const errors = result.errors
    ?.slice(0, 20)
    .map((error) =>
      formatGraphQLError(
        executed
          ? error
          : new GraphQLError('Invalid operation.', { extensions: { code: 'BAD_USER_INPUT' } }),
      ),
    )
  if (errors?.some((error) => error.extensions.code === 'INTERNAL_SERVER_ERROR')) reportUnexpected()
  try {
    return new Response(
      boundedStringify({
        ...(executed && { data: result.data }),
        ...(errors?.length && { errors }),
      }),
      {
        status: executed ? 200 : 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': errors?.length ? 'no-store' : cacheControl,
        },
      },
    )
  } catch {
    return Response.json(
      { data: null, errors: [formatGraphQLError(exceeded())] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
