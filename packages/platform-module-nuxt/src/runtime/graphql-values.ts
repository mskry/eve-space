type GraphQLJSONPrimitive = string | number | boolean | null
export type GraphQLJSONValue =
  | GraphQLJSONPrimitive
  | readonly GraphQLJSONValue[]
  | GraphQLJSONObject
export interface GraphQLJSONObject {
  readonly [key: string]: GraphQLJSONValue
}
export type GraphQLInputValue =
  | GraphQLJSONPrimitive
  | readonly GraphQLInputValue[]
  | GraphQLInputObject
interface GraphQLInputObject {
  readonly [key: string]: GraphQLInputValue | undefined
}
export type GraphQLVariables = GraphQLInputObject

export interface ApplicationGraphQLError {
  readonly message: string
  readonly path?: readonly (string | number)[]
  readonly extensions?: GraphQLJSONObject
}
