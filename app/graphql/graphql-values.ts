type GraphQLJSONPrimitive = string | number | boolean | null
export type GraphQLJSONValue =
  | GraphQLJSONPrimitive
  | readonly GraphQLJSONValue[]
  | GraphQLJSONObject
export interface GraphQLJSONObject {
  readonly [key: string]: GraphQLJSONValue
}
export type GraphQLVariables = Readonly<Record<string, GraphQLJSONValue | undefined>>
