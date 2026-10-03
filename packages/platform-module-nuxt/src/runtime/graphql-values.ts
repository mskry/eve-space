type GraphQLJSONPrimitive = string | number | boolean | null
export type GraphQLJSONValue =
  | GraphQLJSONPrimitive
  | readonly GraphQLJSONValue[]
  | GraphQLJSONObject
export interface GraphQLJSONObject {
  readonly [key: string]: GraphQLJSONValue
}
export type GraphQLVariables = Readonly<Record<string, GraphQLJSONValue | undefined>>

export interface ApplicationGraphQLError {
  readonly message: string
  readonly path?: readonly (string | number)[]
  readonly extensions?: GraphQLJSONObject
}
