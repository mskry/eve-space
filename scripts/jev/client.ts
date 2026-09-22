import {
  TypeSafeClient,
  type EntryType,
  type Questions,
  type SystemOneResult,
} from '@typesafe-ai/sdk'

export type JevClient = Pick<TypeSafeClient, 'systemOne'>

export function createJevClient(): JevClient {
  return new TypeSafeClient()
}

export async function evaluateSystemOne<const Q extends Questions>(
  client: JevClient,
  state: EntryType,
  questions: Q,
): Promise<SystemOneResult<Q>['answers']> {
  const result = await client.systemOne({ state, questions })
  return answersFrom(result)
}

function answersFrom<Q extends Questions>(
  payload: SystemOneResult<Q>,
): SystemOneResult<Q>['answers'] {
  if (!isRecord(payload) || !isRecord(payload.answers))
    throw new Error('TypeSafe response did not contain an answers object')
  return payload.answers
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
